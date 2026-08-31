/**
 * How much of the model's context a conversation is using, and what to do when
 * it no longer fits.
 *
 * ## The failure this exists to prevent
 *
 * `runAgent` sends the entire history on every request, and history only ever
 * grows — a turn adds the reply, every tool call adds its result, and a single
 * `read_file` of a large source file can add thousands of tokens. Past the
 * model's context window the request comes back 400 `prompt is too long`.
 *
 * That is not one failed message. Because nothing was removed, the *next*
 * message fails identically, and so does the one after it. The chat is dead,
 * the natural reaction — send it again — fails the same way, and nothing on
 * screen says why. Losing a long conversation to a wall you were never shown
 * approaching is the worst failure this app has.
 *
 * ## What is done about it, in order of how much it costs you
 *
 * 1. **Trim old tool results.** A file the agent read fifteen turns ago is
 *    almost never needed verbatim again, and it can read it back if it is. This
 *    recovers the most tokens for the least loss, so it happens first.
 * 2. **Summarise older turns.** Everything before a cut point is replaced by a
 *    description of what happened — what was asked, what was read, what was
 *    written, what was run, what was concluded.
 * 3. **Keep fewer turns.** Only if the two above were not enough.
 *
 * The summary is built here, from the messages, rather than by asking the model
 * for one. A model-written summary reads better, but it is another request that
 * costs tokens and can itself fail — and failing *while trying to recover from
 * a failure* is how a bad situation becomes an unrecoverable one. What a coding
 * conversation actually needs carried forward is which files were touched and
 * what was decided, and that is all recoverable from the messages themselves.
 *
 * ## Where the summary goes
 *
 * Into the **system prompt**, not into a fabricated exchange. The alternative —
 * inventing a user message holding the summary and an assistant message
 * agreeing to it — puts words in both participants' mouths and has to worry
 * about role alternation. A description of the conversation so far is context,
 * and context is what a system prompt is.
 *
 * ## The invariant that constrains all of it
 *
 * An assistant message containing `tool_use` blocks **must** be followed by the
 * user message carrying the matching `tool_result` blocks. Cut between them and
 * the next request fails — so a fix for "the context is too long" would have
 * traded it for "the conversation is malformed", which is worse because it
 * never recovers. Every cut here lands on a *turn start*: a user message that
 * is a real question rather than a carrier for tool results.
 */

import type { Block, Msg } from './agent';

export interface Limits {
  /** Everything the request may contain: system, tools, messages and the reply. */
  context: number;
  /** The cap sent as `max_tokens`. Must fit inside `context` alongside the input. */
  maxOutput: number;
}

/**
 * Per-model limits — the **opening guess**, not the answer.
 *
 * Every number here was established without being able to ask anyone, and both
 * of them cost money when wrong: too small a context compacts a conversation
 * early on the models with the most room, and too large a `max_tokens` fails
 * the request outright. `limits.ts` corrects them from the errors that state
 * the real figures, which is the only authoritative source there is; this table
 * is what is used until one of those errors has been seen.
 *
 * Only ids that are *known* get a raised output cap. An unknown id — someone
 * typed a custom model into Settings — gets 4096, which is exactly what every
 * request used before this file existed. Guessing high on an unfamiliar model
 * would break the one case where the user is doing something deliberate.
 */
export const LIMITS: Record<string, Limits> = {
  'claude-haiku-4-5': { context: 200_000, maxOutput: 16_384 },
  'claude-sonnet-5': { context: 200_000, maxOutput: 16_384 },
  'claude-opus-4-8': { context: 200_000, maxOutput: 16_384 },
  'claude-opus-5': { context: 200_000, maxOutput: 16_384 },
};

/** 4096 is what the app sent before this file, so it is the safe unknown. */
export const DEFAULT_LIMITS: Limits = { context: 200_000, maxOutput: 4096 };

/**
 * What to send for this model, given anything already learned about it.
 *
 * `learned` is a plain pair of numbers rather than a store, for the same reason
 * `fit` takes `overhead` rather than a system prompt: this file has no business
 * knowing where those numbers were kept. A learned value wins in **both**
 * directions — it is the model's own statement about itself, so it raises a cap
 * that was too cautious as readily as it lowers one that was too hopeful.
 */
export function limitsFor(model: string, learned?: Partial<Limits>): Limits {
  const base = LIMITS[model] ?? DEFAULT_LIMITS;
  if (learned?.context === undefined && learned?.maxOutput === undefined) return base;

  const context = learned.context ?? base.context;
  // Half the window is already an extreme reply, and `max_tokens` is charged
  // against the same window as the input: letting it claim more than half
  // leaves nowhere to ask the question, `fit` trims the conversation to its
  // floor, and the request fails anyway. Clamping turns an unanswerable request
  // into a shorter answer.
  const maxOutput = Math.min(learned.maxOutput ?? base.maxOutput, Math.floor(context / 2));
  return { context, maxOutput };
}

/**
 * Characters per token.
 *
 * English prose runs about four. Source code and JSON tokenise worse — braces,
 * underscores and indentation are their own tokens — so this is deliberately
 * lower than the usual rule of thumb. Every error here should be an
 * overestimate: compacting slightly early costs a little quality, and
 * compacting slightly late costs the conversation.
 */
const CHARS_PER_TOKEN = 3.5;

/** Roles, delimiters and block framing the API adds around every message. */
const PER_MESSAGE = 8;
const PER_BLOCK = 6;

/**
 * An image's cost is roughly width x height / 750, and we have base64, not
 * dimensions. Bytes per token varies enormously with the format — a screenshot
 * PNG is far more compressible than a photograph — so this errs high and stops
 * at the ceiling Anthropic applies to a single image.
 */
const IMAGE_BYTES_PER_TOKEN = 160;
/**
 * A PDF page is about 40 kB and costs roughly 2,000 tokens, which is where this
 * comes from. Text-heavy documents are denser than that and scans are far
 * thinner, so it is wrong in both directions — but it is wrong by a factor,
 * where the six-token fallback it replaced was wrong by three orders.
 */
const PDF_BYTES_PER_TOKEN = 20;
const IMAGE_MAX_TOKENS = 1600;

export function estimateText(s: string): number {
  return Math.ceil(s.length / CHARS_PER_TOKEN);
}

function estimateBlock(b: Block): number {
  switch (b.type) {
    case 'text':
      return PER_BLOCK + estimateText(b.text);
    case 'image': {
      const bytes = Math.floor((b.source.data?.length ?? 0) * 3 / 4);
      return PER_BLOCK + Math.min(IMAGE_MAX_TOKENS, Math.ceil(bytes / IMAGE_BYTES_PER_TOKEN));
    }
    case 'tool_use':
      // The name and the id are short; the arguments are not — a `write_file`
      // call carries the whole file in its input.
      return PER_BLOCK + estimateText(b.name) + estimateText(JSON.stringify(b.input ?? {}));
    case 'document': {
      // A PDF is charged by the page, at roughly 1,500 to 3,000 tokens each,
      // and nothing here knows the page count — so it is estimated from the
      // bytes. This block existed for one release falling through to `default`
      // below, which valued a fifty-page document at six tokens: `fit` would
      // then never compact, and the request would 400 on a context nobody had
      // been told was full. Erring high is the only safe direction.
      const bytes = Math.floor((b.source?.data?.length ?? 0) * 3 / 4);
      return PER_BLOCK + Math.ceil(bytes / PDF_BYTES_PER_TOKEN);
    }
    case 'tool_result':
      return PER_BLOCK + estimateText(b.content ?? '');
    default:
      return PER_BLOCK;
  }
}

export function estimateMsg(m: Msg): number {
  if (typeof m.content === 'string') return PER_MESSAGE + estimateText(m.content);
  return PER_MESSAGE + m.content.reduce((n, b) => n + estimateBlock(b), 0);
}

export function estimateAll(msgs: Msg[]): number {
  return msgs.reduce((n, m) => n + estimateMsg(m), 0);
}

/** True when this message is a person speaking, not a carrier for tool results. */
function isTurnStart(m: Msg): boolean {
  if (m.role !== 'user') return false;
  if (typeof m.content === 'string') return true;
  return !m.content.some((b) => b.type === 'tool_result');
}

/**
 * The index of every message that begins a turn.
 *
 * These are the only places a conversation may be cut. Index 0 is always
 * included even if the history somehow does not begin with a user message,
 * because "keep nothing" has to remain expressible.
 */
export function turnStarts(msgs: Msg[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < msgs.length; i++) if (isTurnStart(msgs[i])) out.push(i);
  if (msgs.length && (!out.length || out[0] !== 0)) out.unshift(0);
  return out;
}

/** Head and tail with a note in between, so the model knows something is gone. */
function elide(text: string, keep: number): string {
  if (text.length <= keep) return text;
  const head = Math.ceil(keep * 0.7);
  const tail = keep - head;
  const gone = text.length - keep;
  return `${text.slice(0, head)}\n… ${gone} characters trimmed to fit the context; read the file again if you need them …\n${text.slice(text.length - tail)}`;
}

/** A copy of the message with its long tool results shortened. */
function trimResults(m: Msg, keep: number): Msg {
  if (typeof m.content === 'string') return m;
  let changed = false;
  const content = m.content.map((b) => {
    if (b.type !== 'tool_result' || (b.content ?? '').length <= keep) return b;
    changed = true;
    return { ...b, content: elide(b.content, keep) };
  });
  return changed ? { ...m, content } : m;
}

function textOf(m: Msg): string {
  if (typeof m.content === 'string') return m.content;
  return m.content.filter((b): b is Extract<Block, { type: 'text' }> => b.type === 'text')
    .map((b) => b.text).join('\n');
}

function clip(s: string, n: number): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length <= n ? flat : `${flat.slice(0, n - 1)}…`;
}

const SUMMARY_MAX = 4000;

/**
 * What happened in the messages being dropped, as prose the model can use.
 *
 * Deliberately about *artefacts* rather than dialogue: which files were read,
 * changed or created, and which commands ran. Six turns later the useful
 * residue of "read App.tsx" is not the file, it is the fact that App.tsx is
 * where this work lives.
 */
export function summarise(dropped: Msg[]): string {
  if (!dropped.length) return '';
  const parts: string[] = [];
  let n = 0;
  let asked = '';
  let read = new Set<string>();
  let wrote = new Set<string>();
  let ran: string[] = [];
  let said = '';

  const flush = () => {
    if (!asked && !wrote.size && !ran.length) return;
    n += 1;
    const bits = [`${n}. Asked: ${asked || '(continued)'}`];
    if (read.size) bits.push(`   Read: ${[...read].join(', ')}`);
    if (wrote.size) bits.push(`   Changed: ${[...wrote].join(', ')}`);
    if (ran.length) bits.push(`   Ran: ${ran.join(' ; ')}`);
    if (said) bits.push(`   Answered: ${said}`);
    parts.push(bits.join('\n'));
    asked = ''; said = ''; read = new Set(); wrote = new Set(); ran = [];
  };

  for (const m of dropped) {
    if (isTurnStart(m)) {
      flush();
      asked = clip(textOf(m), 240);
      continue;
    }
    if (m.role === 'assistant') {
      const t = clip(textOf(m), 240);
      if (t) said = t;
      if (typeof m.content !== 'string') {
        for (const b of m.content) {
          if (b.type !== 'tool_use') continue;
          const path = String((b.input as Record<string, unknown>)?.path ?? '');
          if (b.name === 'read_file' && path) read.add(path);
          else if ((b.name === 'write_file' || b.name === 'edit_file') && path) wrote.add(path);
          else if (b.name === 'run_command') {
            ran.push(clip(String((b.input as Record<string, unknown>)?.command ?? ''), 80));
          }
        }
      }
    }
  }
  flush();

  const body = parts.join('\n');
  return clip0(body, SUMMARY_MAX);
}

/** Truncate on a line boundary, so a summary never ends mid-fact. */
function clip0(s: string, n: number): string {
  if (s.length <= n) return s;
  const cut = s.slice(0, n);
  const nl = cut.lastIndexOf('\n');
  return `${nl > n / 2 ? cut.slice(0, nl) : cut}\n… earlier turns omitted …`;
}

export interface Fitted {
  /** What to send. */
  messages: Msg[];
  /** Prose for the system prompt describing what was cut, or ''. */
  summary: string;
  /** How many messages were replaced by the summary. */
  dropped: number;
  /** How many messages had a tool result shortened. */
  trimmed: number;
  /** Estimated tokens in `messages`. */
  tokens: number;
  /** True when even the minimum did not fit — the request will probably fail. */
  over: boolean;
}

/** Turns always kept verbatim, however long they are. Two exchanges of context. */
const KEEP_TURNS = 4;
/** Below this many, cutting further loses the thing being worked on. */
const MIN_TURNS = 1;
/** A trimmed old tool result keeps this much. Enough to recognise, not to reuse. */
const OLD_RESULT_KEEP = 600;
/** The same, once we are desperate and trimming inside the kept turns. */
const HARD_RESULT_KEEP = 200;

/**
 * Fit a conversation into the space left after the system prompt, the tool
 * schemas and the reply.
 *
 * `overhead` is everything in the request that is not `messages`. The caller
 * knows it — it has the system prompt and the tool array in hand — and passing
 * it in keeps this function free of any knowledge of either.
 */
export function fit(msgs: Msg[], limits: Limits, overhead: number): Fitted {
  const budget = Math.max(1000, limits.context - overhead);
  const none = (messages: Msg[], extra: Partial<Fitted> = {}): Fitted => ({
    messages, summary: '', dropped: 0, trimmed: 0, tokens: estimateAll(messages), over: false, ...extra,
  });

  if (estimateAll(msgs) <= budget) return none(msgs);

  const starts = turnStarts(msgs);
  // Where the verbatim tail begins. Everything from here is never summarised,
  // because it is the work actually in progress.
  const keepFrom = starts.length > KEEP_TURNS ? starts[starts.length - KEEP_TURNS] : 0;

  // 1. Trim tool results in the older part.
  let trimmed = 0;
  let work = msgs.map((m, i) => {
    if (i >= keepFrom) return m;
    const t = trimResults(m, OLD_RESULT_KEEP);
    if (t !== m) trimmed += 1;
    return t;
  });
  if (estimateAll(work) <= budget) return none(work, { trimmed });

  // 2. Summarise from the front, cutting only at turn starts, and stop as soon
  //    as it fits — dropping more than necessary throws away context for free.
  const cuts = turnStarts(work).filter((i) => i > 0);
  const maxCuts = Math.max(0, cuts.length - (MIN_TURNS - 1) - 1);
  for (let k = 0; k < Math.min(cuts.length, maxCuts + 1); k++) {
    const at = cuts[k];
    const kept = work.slice(at);
    const summary = summarise(work.slice(0, at));
    const tokens = estimateAll(kept) + estimateText(summary);
    if (tokens <= budget) {
      return { messages: kept, summary, dropped: at, trimmed, tokens: estimateAll(kept), over: false };
    }
  }

  // 3. Everything but the last turn is gone and it still does not fit, so the
  //    current turn is itself enormous. Trim its results hard rather than
  //    cutting it, which would orphan a tool_use.
  const at = cuts.length ? cuts[cuts.length - 1] : 0;
  const summary = summarise(work.slice(0, at));
  work = work.slice(at).map((m) => {
    const t = trimResults(m, HARD_RESULT_KEEP);
    if (t !== m) trimmed += 1;
    return t;
  });
  const tokens = estimateAll(work);
  return { messages: work, summary, dropped: at, trimmed, tokens, over: tokens + estimateText(summary) > budget };
}

/** The system-prompt section carrying a summary, or '' when nothing was cut. */
export function summaryBlock(summary: string): string {
  if (!summary) return '';
  return [
    '## Earlier in this conversation',
    '',
    'This conversation is longer than the context window, so the turns before',
    'the ones below were replaced by this summary. The user can still see the',
    'whole transcript; you cannot. Read a file again rather than assuming its',
    'contents from here.',
    '',
    summary,
  ].join('\n');
}
