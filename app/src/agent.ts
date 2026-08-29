import { invoke } from '@tauri-apps/api/core';
import type { Pending } from './pending';
import { appendFact, MEMORY_FILE } from './memory';
import { callTool, splitTool } from './mcp';
import { SSEDecoder, TurnAssembler } from './sse';
import { add, fold, NO_USAGE, type Usage } from './usage';
import { fit, limitsFor, estimateText, summaryBlock, type Fitted } from './budget';
import { learn, learnedFor, parseLimitError, type Learned, type LimitKind } from './limits';
import { MAX_ATTEMPTS, backoffMs, pause, retryable, retryableMessage } from './retry';

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
/**
 * Tools that only look. Ask mode is given exactly these.
 *
 * The distinction is enforced by *sending a smaller array*, not by telling the
 * model to behave. That is the same reason `apply_write` is absent from the
 * schema rather than forbidden in the prompt: an instruction is a request, and
 * a missing tool is a fact.
 */
export const READ_TOOLS = [
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
    name: 'find_symbol',
    description:
      'Find where something is declared — a function, class, type, struct or heading — by name. '
      + 'Prefer this over search when you want a definition: search returns every mention, '
      + 'including call sites, imports and comments, and leaves you to read through them. '
      + 'Matches on a substring of the name, exact matches first.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The name, or part of it.' },
        limit: { type: 'integer', description: 'Cap on results. Default 40.' },
      },
      required: ['name'],
    },
  },
  {
    name: 'search',
    description:
      'Find a literal substring across the open folder. Returns path, line number and the matching line. '
      + 'Not a regex. Results are ordered by how much each file is about the query, so the first few are '
      + 'usually the ones worth reading. Use find_symbol instead when you want a declaration.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Literal text to find.' },
        max_hits: { type: 'integer', description: 'Cap on hits returned. Default 200.' },
      },
      required: ['query'],
    },
  },
];

/** Tools that change something, or ask to. Only Agent mode gets these. */
export const WRITE_TOOLS = [
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
    name: 'remember',
    description:
      `Save a durable fact about this project to ${MEMORY_FILE} so it survives between sessions — a convention, a command that works here, a decision and its reason. STAGED for the user to approve like any other edit. Do not use it for one-off details or anything you can simply read from the code.`,
    input_schema: {
      type: 'object',
      properties: {
        fact: { type: 'string', description: 'One sentence, self-contained, useful weeks from now.' },
      },
      required: ['fact'],
    },
  },
] as const;

/** Everything, for Agent mode. `TOOLS` is kept as the name callers know. */
export const TOOLS = [...READ_TOOLS, ...WRITE_TOOLS];

export type Mode = 'ask' | 'agent';

/**
 * Ask mode adds a sentence, but the sentence is not what stops anything.
 *
 * The model is simply not given the tools, so it cannot stage an edit however
 * it is prompted. This exists so it does not offer to do things it has no way
 * of doing, which reads as a broken promise rather than a limit.
 */
const ASK_NOTE = [
  '',
  'You are in **Ask** mode. You can read this project but not change it: the',
  'tools for staging edits and running commands are not available to you. If a',
  'change is needed, describe it — including the exact edit you would make — and',
  'say that switching to Agent mode will let you propose it.',
].join('\n');

const BASE_SYSTEM = [
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
  '',
  `If you learn something durable about this project — a convention, a command`,
  `that works here, a decision and why — offer to remember it. Memory lives in`,
  `${MEMORY_FILE} in the repository, so it is reviewable and shared with the team`,
  `rather than hidden in this app.`,
  '',
  'Be concise. Cite paths as path:line when you can.',
].join('\n');

/** Run one tool call. Reads hit the Rust side; writes are staged, not applied. */
export interface CommandRequest {
  command: string;
  reason: string;
  /** `mcp` changes what the dialog says; a tool call is not a shell command. */
  kind?: 'shell' | 'mcp';
}
/**
 * How a human answered. `terminal` runs the same approved string in a visible
 * pty instead of a pipe — a different surface for the same decision, not a
 * second decision.
 */
export type RunChoice = 'no' | 'pipe' | 'terminal';
export type AskToRun = (req: CommandRequest) => Promise<RunChoice>;
export interface CommandResult { code: number | null; output: string; truncated: boolean }

async function runTool(
  root: string, call: ToolCall, pending: Pending, ask: AskToRun,
  runInTerminal?: (command: string) => Promise<CommandResult>,
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
      if (decision === 'no') {
        return { content: 'The user declined to run that command.', isError: false };
      }

      if (decision === 'terminal') {
        if (!runInTerminal) {
          return { content: 'Running in a terminal is unavailable here.', isError: true };
        }
        const t = await runInTerminal(command);
        const parts = [`exit code: ${t.code ?? 'unknown'} (run in the user's terminal)`];
        parts.push(t.output.trim() ? `output:\n${t.output}` : '(no output)');
        if (t.truncated) parts.push('(output was truncated)');
        return { content: parts.join('\n\n'), isError: false };
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
    if (call.name === 'remember') {
      const fact = String(call.input.fact ?? '').trim();
      if (!fact) return { content: 'fact was empty', isError: true };
      // Memory is a file, so remembering is an edit -- same staging, same diff,
      // same approval. A fact the user has not seen is not memory, it is the
      // agent talking to itself.
      let current = '';
      try { current = await pending.currentContent(root, MEMORY_FILE); } catch { current = ''; }
      await pending.stageWrite(root, MEMORY_FILE, appendFact(current, fact));
      return {
        content: `Staged an addition to ${MEMORY_FILE}. It becomes memory once the user approves it.`,
        isError: false,
      };
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
    if (call.name === 'find_symbol') {
      const hits = await invoke('find_symbol', {
        root,
        name: String(call.input.name ?? ''),
        limit: call.input.limit ?? null,
      });
      return { content: JSON.stringify(hits), isError: false };
    }
    if (call.name === 'search') {
      const hits = await invoke('search', {
        root,
        query: String(call.input.query ?? ''),
        maxHits: call.input.max_hits ?? null,
      });
      return { content: JSON.stringify(hits), isError: false };
    }
    // An MCP tool: third-party code with side effects nothing about its name
    // reveals, so it goes through the same gate as run_command rather than
    // running because the model asked.
    const ext = splitTool(call.name);
    if (ext) {
      const decision = await ask({
        command: `${ext.server}: ${ext.tool}(${JSON.stringify(call.input)})`,
        reason: 'This tool comes from an MCP server, not from Vylo Editor.',
        kind: 'mcp',
      });
      if (decision === 'no') {
        return { content: 'The user declined to run that tool.', isError: false };
      }
      const out = await callTool(ext.server, ext.tool, call.input);
      return { content: out || '(the tool returned nothing)', isError: false };
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
  /** Suspends the loop until a human decides. Resolve 'no' to decline. */
  askToRun: AskToRun;
  /** Runs an already-approved command in a visible terminal tab. */
  runInTerminal?: (command: string) => Promise<CommandResult>;
  /** Project memory block, appended to the system prompt. Empty when there is none. */
  memory?: string;
  /** Called as the loop progresses so the UI can show work in flight. */
  onEvent: (e: { kind: 'tool' | 'result'; text: string }) => void;
  /**
   * A piece of the reply, as it is written. Called once per delta when
   * streaming and once per block when not, so the caller has one path either
   * way and never has to know which transport ran.
   */
  onDelta: (text: string) => void;
  /** Aborts the turn. The partial reply is kept; incomplete tool calls are not. */
  signal?: AbortSignal;
  /** Fired whenever the staged set changes, so the review panel can update mid-turn. */
  onStaged?: () => void;
  /** Stop after this many model round-trips. A loop that will not terminate is a bill. */
  maxHops?: number;
  /** Tools from enabled MCP servers, already namespaced. */
  extraTools?: unknown[];
  /** Ask reads; Agent may also stage and request commands. Default agent. */
  mode?: Mode;
  /** Tokens for the whole turn, once it ends. Hops are summed. */
  onUsage?: (u: Usage) => void;
  /**
   * How full the context is, before each request. Lets the status bar show the
   * wall coming rather than announcing it after impact.
   */
  onContext?: (used: number, limit: number) => void;
  /** Called once, the first time a turn has to drop history to fit. */
  onCompact?: (info: { dropped: number; trimmed: number; kept: number }) => void;
  /** A request is being sent again after a failure worth retrying. */
  onRetry?: (attempt: number, of: number) => void;
  /**
   * The gateway named this model's real limit and the request was corrected and
   * sent again. Reports a correction, not a failure — the turn carries on.
   */
  onLimit?: (kind: LimitKind, value: number) => void;
  /**
   * Discard whatever this hop has streamed so far — it is about to be asked
   * for again. Without this an automatic retry appends a second copy of a
   * half-written reply beneath the first.
   */
  onRestart?: () => void;
}

/**
 * Raised when the user stops a turn. Not an error to report as a failure.
 *
 * Carries the conversation as it stands, because stopping is a decision about
 * something already read: whatever the model had said before the stop is part
 * of the conversation, and dropping it would leave the transcript showing a
 * reply the model has no memory of giving.
 */
export class Stopped extends Error {
  constructor(readonly messages: Msg[]) { super('stopped'); this.name = 'Stopped'; }
}

/**
 * Raised when a turn uses up its hops. Everything it did travels on it.
 *
 * The cap is a spending control and has to stop the loop, but the work up to it
 * is work already paid for: every file read, every search, every tool result.
 * Throwing without the conversation discarded all of it — `history.current =
 * await runAgent(...)` never runs on a throw — and left the user a Try again
 * button that bought the same twelve hops to reach the same wall. On a metered
 * plan that was the most expensive failure in the app, and it fired on exactly
 * the expensive turns. Second instance of a lesson already written down:
 * `throw` discards everything the function built.
 *
 * ## Resuming needs nothing added to the conversation
 *
 * The loop's last act before the cap is `messages.push({ role: 'user', content:
 * results })` — tool results for calls the model made. That is a complete,
 * valid request exactly as it stands, so continuing is *calling `runAgent`
 * again with these messages* and nothing else.
 *
 * Do **not** append a synthetic "please continue" message. It would be a second
 * consecutive user message, and it puts words in the user's mouth: the model
 * can see where it got to, and what it has in front of it is its own tool
 * results, which is what it asked for.
 *
 * ## And it stays a human press
 *
 * Nothing here re-enters the loop on its own. A cap that continues
 * automatically is not a cap; it is a pause with extra steps.
 */
export class HopLimit extends Error {
  constructor(readonly messages: Msg[], readonly hops: number) {
    super(`Stopped after ${hops} hops without finishing.`);
    this.name = 'HopLimit';
  }
}

/**
 * The conversation with any half-finished tool call removed.
 *
 * An assistant message holding `tool_use` blocks must be followed by their
 * `tool_result`s, so a turn interrupted between the two cannot keep that
 * message — the *next* request would fail for being malformed. Its text is
 * worth keeping and its tool calls are not, which is the whole rule.
 */
export function keepText(messages: Msg[]): Msg[] {
  const last = messages[messages.length - 1];
  if (!last || last.role !== 'assistant' || typeof last.content === 'string') return messages;
  if (!last.content.some((b) => b.type === 'tool_use')) return messages;
  const text = last.content
    .filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text).join('').trim();
  const head = messages.slice(0, -1);
  return text ? [...head, { role: 'assistant', content: text }] : head;
}

/**
 * The tools for this turn.
 *
 * MCP tools are excluded from Ask mode as well. A third-party tool's side
 * effects are not visible from its schema — a name like `query` could write —
 * so "Ask changes nothing" can only hold if they are left out.
 */
function toolsFor(o: RunOptions): unknown[] {
  if (o.mode === 'ask') return [...READ_TOOLS];
  return [...TOOLS, ...(o.extraTools ?? [])];
}

function system(o: RunOptions, summary = ''): string {
  const base = o.mode === 'ask' ? `${BASE_SYSTEM}\n${ASK_NOTE}` : BASE_SYSTEM;
  const parts = [base];
  if (o.memory) parts.push(o.memory);
  // After the memory: what the model was just told about the project outranks
  // an account of a conversation it can no longer see.
  const cut = summaryBlock(summary);
  if (cut) parts.push(cut);
  return parts.join('\n\n');
}

/**
 * Everything in a request that is not `messages`, in tokens.
 *
 * The reply is counted too. Anthropic requires the input and `max_tokens`
 * together to fit inside the context window, so room for the answer has to be
 * reserved before deciding how much of the conversation to send — otherwise a
 * request that fits perfectly is rejected for having nowhere to put its reply.
 */
function overheadOf(o: RunOptions, maxOutput: number): number {
  return estimateText(system(o))
    + estimateText(JSON.stringify(toolsFor(o)))
    + maxOutput
    // The estimate is a character count, not a tokeniser. A margin costs a
    // little of a 200k window and covers being wrong in the direction that
    // fails the request.
    + 2000;
}

export async function runAgent(o: RunOptions): Promise<Msg[]> {
  const messages: Msg[] = [...o.history];
  const maxHops = o.maxHops ?? 12;
  // A turn is several requests, and each is billed. Reporting one hop would
  // understate a turn that read six files before answering.
  let spent: Usage = NO_USAGE;
  const report = () => o.onUsage?.(spent);
  // The table in budget.ts is the opening guess. A model that has already
  // corrected us — by refusing a request and saying what its real limit is —
  // has its own numbers, and they win.
  let learned: Learned = learnedFor(o.model);
  let limits = limitsFor(o.model, learned);
  // Announced once per turn, not once per hop: a long turn compacts on every
  // request after the first, and saying so nine times is noise.
  let toldAboutCompaction = false;

  for (let hop = 0; hop < maxHops; hop++) {
    // Fit before every request, not once per turn — a turn that reads six files
    // can cross the line partway through, and the hop that crosses it is the
    // one that would fail. It is a function because a corrected context window
    // means fitting again against the new number before sending.
    const refit = (): Fitted => {
      const f = fit(messages, limits, overheadOf(o, limits.maxOutput));
      o.onContext?.(f.tokens + overheadOf(o, limits.maxOutput), limits.context);
      if (!toldAboutCompaction && (f.dropped || f.trimmed)) {
        toldAboutCompaction = true;
        o.onCompact?.({ dropped: f.dropped, trimmed: f.trimmed, kept: f.messages.length });
      }
      return f;
    };
    let fitted: Fitted = refit();
    /**
     * Limit kinds already corrected on this request.
     *
     * One corrective retry per kind, so a gateway that keeps naming the same
     * number cannot turn a failure into a loop. `learned` is the second guard:
     * a value already held is not worth sending the request again for.
     */
    const corrected = new Set<LimitKind>();
    /**
     * One hop, with retries.
     *
     * A dropped connection or a 502 is the network having a bad second, not the
     * conversation being over — and the old behaviour, ending the turn at the
     * first thing that went wrong, left retyping the question as the only way
     * forward. What is *not* retried is anything saying the request itself was
     * wrong: a bad key sent three times is the same answer with the useful
     * message buried under two minutes of waiting.
     */
    let blocks: Block[] = [];
    let stopReason: string | null = null;

    for (let attempt = 1; ; attempt++) {
      if (o.signal?.aborted) throw new Stopped(keepText(messages));
      /** Wait and go round again, or -1 when this is as far as it goes. */
      const again = (ok: boolean, header?: string | null) =>
        (ok && attempt < MAX_ATTEMPTS ? backoffMs(attempt, header) : -1);

      let res: Response;
      try {
        res = await fetch(`${o.baseUrl}/v1/messages`, {
          method: 'POST',
          signal: o.signal,
          headers: {
            'content-type': 'application/json',
            'x-api-key': o.apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify({
            model: o.model,
            max_tokens: limits.maxOutput,
            system: system(o, fitted.summary),
            tools: toolsFor(o),
            messages: fitted.messages,
            stream: true,
          }),
        });
      } catch (e) {
        if (o.signal?.aborted) throw new Stopped(keepText(messages));
        const wait = again(retryable(0));
        if (wait >= 0) {
          o.onRetry?.(attempt + 1, MAX_ATTEMPTS);
          await pause(wait, o.signal);
          continue;
        }
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

        // A 400 that names the model's real limit is worth more than the
        // failure: it is the only authoritative statement of that number
        // anywhere — it came from the API, not from a table someone maintains.
        // Record it, correct this request, and send it again, so the failure
        // becomes the last time it happens for this model rather than the first
        // of many. Only on 400: a 429 talks about a minute, not about a model.
        const named = res.status === 400 ? parseLimitError(detail) : null;
        if (named && !corrected.has(named.kind) && learned[named.kind] !== named.value) {
          corrected.add(named.kind);
          // Persisting can fail (quota, storage off) and this turn does not
          // care: what corrects the request is `learned`, held here.
          learn(o.model, named);
          learned = { ...learned, [named.kind]: named.value };
          limits = limitsFor(o.model, learned);
          fitted = refit();
          o.onLimit?.(named.kind, named.value);
          // Not a failed attempt. The request was well formed and one number in
          // it was wrong; charging it to the retry budget would leave the
          // corrected request with one fewer try at a dropped connection.
          attempt -= 1;
          continue;
        }

        const wait = again(retryable(res.status, detail), res.headers.get('retry-after'));
        if (wait >= 0) {
          o.onRetry?.(attempt + 1, MAX_ATTEMPTS);
          await pause(wait, o.signal);
          continue;
        }
        if (res.status === 401) throw new Error(`The gateway rejected the API key. Check it in Settings. (${detail})`);
        if (res.status === 429) throw new Error(`Rate limited by the gateway — wait a moment. (${detail})`);
        throw new Error(`Gateway ${res.status}: ${detail}`);
      }

      if (res.headers.get('content-type')?.includes('text/event-stream') && res.body) {
        const assembler = new TurnAssembler();
        const decoder = new SSEDecoder();
        const reader = res.body.getReader();
        const utf8 = new TextDecoder();
        let broke: unknown = null;
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            // stream:true keeps a multi-byte character intact across chunks.
            for (const ev of decoder.decode(utf8.decode(value, { stream: true }))) {
              assembler.push(ev, (t) => o.onDelta(t));
            }
          }
        } catch (e) {
          // Stopping mid-stream keeps the text and drops everything else. A
          // tool_use block with no matching tool_result makes the very NEXT
          // request fail, so half a tool call would poison the conversation
          // rather than end the turn.
          if (o.signal?.aborted) {
            const partial = assembler.partialText();
            if (partial.trim()) messages.push({ role: 'assistant', content: partial });
            // Stopping does not refund what was already spent, so it is reported.
            spent = add(spent, assembler.usage);
            report();
            throw new Stopped(keepText(messages));
          }
          broke = e;
        } finally {
          reader.releaseLock();
        }

        // A connection that died partway through, or an `error` frame from the
        // API. Neither is refunded, so both are counted before deciding.
        const failure = broke ? String(broke) : assembler.error;
        if (failure) {
          spent = add(spent, assembler.usage);
          const wait = again(broke ? true : retryableMessage(failure));
          if (wait >= 0) {
            // The half-written reply is already on screen. Asking again without
            // clearing it would print the answer twice, one incomplete copy
            // above the other.
            o.onRestart?.();
            o.onRetry?.(attempt + 1, MAX_ATTEMPTS);
            await pause(wait, o.signal);
            continue;
          }
          report();
          throw broke instanceof Error ? broke : new Error(failure);
        }
        blocks = assembler.blocks();
        stopReason = assembler.stopReason;
        spent = add(spent, assembler.usage);
      } else {
        // A gateway that does not stream still answers, and an app that only
        // works against the newest server is a support problem.
        const reply = await res.json();
        blocks = Array.isArray(reply.content) ? reply.content : [];
        stopReason = reply.stop_reason ?? null;
        spent = add(spent, fold(NO_USAGE, reply.usage));
        for (const b of blocks) {
          if (b.type === 'text' && b.text.trim()) o.onDelta(b.text);
        }
      }
      break;
    }

    messages.push({ role: 'assistant', content: blocks });

    const calls = blocks.filter((b): b is Extract<Block, { type: 'tool_use' }> => b.type === 'tool_use');
    if (stopReason !== 'tool_use' || calls.length === 0) { report(); return messages; }

    // Every tool_result for a turn goes back in ONE user message. Splitting them
    // across several would break the alternation the API expects, and trains the
    // model out of asking for calls in parallel.
    const results: Block[] = [];
    for (const c of calls) {
      if (o.signal?.aborted) throw new Stopped(keepText(messages));
      o.onEvent({ kind: 'tool', text: `${c.name}(${JSON.stringify(c.input)})` });
      const r = await runTool(
        o.root, { id: c.id, name: c.name, input: c.input }, o.pending, o.askToRun, o.runInTerminal,
      );
      o.onEvent({ kind: 'result', text: `${c.name} → ${r.isError ? 'error: ' : ''}${r.content.slice(0, 160)}` });
      if (c.name === 'write_file' || c.name === 'edit_file') o.onStaged?.();
      results.push({ type: 'tool_result', tool_use_id: c.id, content: r.content, is_error: r.isError || undefined });
    }
    messages.push({ role: 'user', content: results });
  }

  // The cap, reached. Everything this turn did travels on the exception rather
  // than being discarded with it — see `HopLimit`, which is also where the
  // reason a resume needs no extra message is written down. `keepText` is a
  // formality here, since the loop only arrives with tool results just pushed,
  // but it keeps the rule in one place: nothing leaves this function carrying a
  // `tool_use` with no `tool_result`.
  report();
  throw new HopLimit(keepText(messages), maxHops);
}
