import { Annotation, StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType, type DecorationSet } from '@codemirror/view';
import { SSEDecoder, TurnAssembler } from './sse';
import { diffRows } from './pending';
import { limitsFor } from './budget';
import { highlightRange, spansToDOM, type Span } from './highlight';

/**
 * ⌘K — rewrite a selection in place.
 *
 * This does **not** go through the agent loop. The loop exists so a model can
 * look around a repository before acting; here the human has already said which
 * lines they mean, so a single request with that region and its surroundings is
 * both faster and cheaper, and there is nothing for a tool call to do.
 *
 * It also creates no new write path. The result lands in the *buffer*, exactly
 * as if it had been typed, and reaches disk only when the human saves through
 * `apply_write` with its stale-write guard. That is what keeps ⌘K inside the
 * rule the app rests on rather than beside it.
 */

/** Lines of surrounding code sent either side of the selection. */
const CONTEXT_LINES = 60;

const SYSTEM = [
  'You rewrite one selected region of a source file, following an instruction.',
  '',
  'Output ONLY the replacement text for the selected region. No explanation, no',
  'commentary, no markdown fences, and never repeat the code shown before or',
  'after the selection — that code is context, not part of your answer.',
  '',
  'Match the file exactly: its indentation, quote characters, naming and',
  'conventions. Keep the indentation of the first line, because it replaces text',
  'that was already indented. Change only what the instruction asks for; leaving',
  'the rest of the region alone is what makes the result reviewable.',
].join('\n');

export interface EditRequest {
  path: string;
  language: string;
  /** Everything before the selection, already trimmed to the context window. */
  before: string;
  selection: string;
  after: string;
  instruction: string;
  /** Project memory, appended to the system prompt when there is any. */
  memory?: string;
}

/** The lines either side of a region, capped so a large file is not re-sent. */
export function contextAround(doc: string, from: number, to: number): { before: string; after: string } {
  const head = doc.slice(0, from).split('\n');
  const tail = doc.slice(to).split('\n');
  return {
    before: head.slice(Math.max(0, head.length - CONTEXT_LINES)).join('\n'),
    after: tail.slice(0, CONTEXT_LINES).join('\n'),
  };
}

export function editMessages(r: EditRequest): { system: string; user: string } {
  const empty = !r.selection.length;
  const user = [
    `File: ${r.path}`,
    r.language ? `Language: ${r.language}` : null,
    '',
    '<code_before>',
    r.before,
    '</code_before>',
    empty ? '<insert_here/>' : '<selected_region>',
    empty ? null : r.selection,
    empty ? null : '</selected_region>',
    '<code_after>',
    r.after,
    '</code_after>',
    '',
    `Instruction: ${r.instruction}`,
    '',
    empty
      ? 'Write the code to insert at that point:'
      : 'Replacement for the selected region:',
  ].filter((l) => l !== null).join('\n');
  return { system: r.memory ? `${SYSTEM}\n\n${r.memory}` : SYSTEM, user };
}

/**
 * Make what the model said safe to drop into a buffer.
 *
 * Each rule is here because a model does the thing it removes. Fences are the
 * common one even when told not to; echoing the surrounding context back is the
 * expensive one, because it silently duplicates code that is already in the
 * file just outside the region being replaced.
 */
export function cleanEdit(raw: string, ctx: { before?: string; after?: string } = {}): string {
  let s = String(raw ?? '');
  if (!s.trim()) return '';

  const fence = s.match(/^\s*```[a-zA-Z0-9_+-]*\n([\s\S]*?)(?:\n```|```)?\s*$/);
  if (fence) s = fence[1];
  s = s.replace(/\n?```\s*$/, '');

  // A leading blank line is an artifact of the model starting after the prompt;
  // it would push the region down by one every time.
  s = s.replace(/^\n+/, '');
  // Trailing whitespace on the last line is never wanted. A trailing newline is
  // also never wanted: the replaced range did not include one.
  s = s.replace(/\s+$/, '');

  // Echoed context. The last line before the region and the first line after it
  // are the two the model repeats, and both would duplicate real code.
  const lastBefore = (ctx.before ?? '').split('\n').pop() ?? '';
  if (lastBefore.trim().length > 2) {
    const lines = s.split('\n');
    if (lines[0].trim() === lastBefore.trim()) s = lines.slice(1).join('\n');
  }
  const firstAfter = (ctx.after ?? '').split('\n').find((l) => l.trim()) ?? '';
  if (firstAfter.trim().length > 2) {
    const lines = s.split('\n');
    const dup = lines.findIndex((l) => l.trim() === firstAfter.trim());
    if (dup > 0) s = lines.slice(0, dup).join('\n');
  }

  return s.replace(/[ \t]+$/, '');
}

/** `+N −M` for the bar, so the size of an edit is visible before accepting it. */
export function editSize(before: string, after: string): { added: number; removed: number } {
  const rows = diffRows(before, after);
  return {
    added: rows.filter((r) => r.kind === '+').length,
    removed: rows.filter((r) => r.kind === '-').length,
  };
}

/* ── the in-place preview ───────────────────────────────────────────────── */

export interface Pending {
  from: number;
  to: number;
  /** What was there before, so rejecting can put it back exactly. */
  original: string;
  /** Only names the language for the preview; nothing here reads the file. */
  path: string;
}

export const setPendingEdit = StateEffect.define<Pending | null>();

/** Marks the transactions this feature makes, so the field does not clear itself. */
export const fromInlineEdit = Annotation.define<boolean>();

/** The replaced lines, shown above the new ones so the change is reviewable. */
class RemovedWidget extends WidgetType {
  constructor(readonly text: string, readonly spans: Span[][]) { super(); }
  /**
   * The grammars load on demand, so a widget built before they arrive would
   * never be rebuilt if only its text were compared — and would sit grey next
   * to the coloured code it is replacing.
   */
  eq(o: RemovedWidget) {
    return o.text === this.text && o.spans.some(hasClass) === this.spans.some(hasClass);
  }
  toDOM() {
    const box = document.createElement('div');
    box.className = 'cm-was';
    this.text.split('\n').forEach((line, i) => box.appendChild(spansToDOM(this.spans[i], line)));
    return box;
  }
  ignoreEvent() { return true; }
}

const hasClass = (line: Span[]) => line.some((s) => !!s.cls);

export const pendingEdit = StateField.define<Pending | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setPendingEdit)) return e.value;
    if (!value) return null;
    // Any edit the user makes themselves settles the question: the preview has
    // become their text, and there is nothing left to accept or reject.
    if (tr.docChanged && !tr.annotation(fromInlineEdit)) return null;
    return value ? { ...value, from: tr.changes.mapPos(value.from), to: tr.changes.mapPos(value.to) } : null;
  },
});

const decorations = EditorView.decorations.compute([pendingEdit], (state) => {
  const p = state.field(pendingEdit, false);
  if (!p) return Decoration.none;
  const marks = [];
  if (p.original) {
    const at = state.doc.lineAt(p.from).from;
    // The buffer already holds the *new* text, so the old lines have to be
    // parsed against the document they came out of — rebuilt here by putting
    // them back. Highlighting them on their own would read a method body as a
    // program: `}` alone is a syntax error and half a template literal is code
    // rather than the prose it actually is.
    const doc = state.doc.toString();
    const original = doc.slice(0, p.from) + p.original + doc.slice(p.to);
    const spans = highlightRange(original, p.path, p.from, p.from + p.original.length);
    marks.push(Decoration.widget({
      widget: new RemovedWidget(p.original, spans), block: true, side: -1,
    }).range(at));
  }
  const first = state.doc.lineAt(p.from).number;
  const last = state.doc.lineAt(Math.min(p.to, state.doc.length)).number;
  for (let n = first; n <= last; n++) {
    marks.push(Decoration.line({ class: 'cm-now' }).range(state.doc.line(n).from));
  }
  return Decoration.set(marks, true) as DecorationSet;
});

export const inlineEditState: Extension = [
  pendingEdit,
  decorations,
  EditorView.baseTheme({
    '.cm-now': { backgroundColor: 'var(--ok-wash, rgba(107,214,174,.14))' },
    '.cm-was': {
      backgroundColor: 'var(--err-wash, rgba(240,137,124,.13))',
      // Faded rather than recoloured. A flat mute colour would say "secondary"
      // by overwriting the syntax colours, which is the same as saying it in
      // the one way that also makes the code harder to read; the strike-through
      // was already carrying that meaning on its own.
      opacity: '.7',
      textDecoration: 'line-through',
      padding: '1px 0',
    },
  }),
];

/* ── the request ────────────────────────────────────────────────────────── */

export interface Gateway { baseUrl: string; apiKey: string; model: string }

/**
 * One streamed, tool-free request. Deltas go to `onText` so the bar can show
 * the edit arriving; the document is only touched once, when it is complete,
 * which keeps undo to a single entry instead of one per token.
 */
/**
 * One streamed, tool-free request returning the raw reply.
 *
 * Shared with "apply from chat", which needs the same transport but its own
 * prompt and its own idea of what a clean answer looks like.
 */
export async function askRaw(
  gw: Gateway,
  system: string,
  user: string,
  onText: (chunk: string) => void = () => {},
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch(`${gw.baseUrl}/v1/messages`, {
    method: 'POST',
    signal,
    headers: {
      'content-type': 'application/json',
      'x-api-key': gw.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: gw.model,
      // A selection rewrite is bounded by the selection, but a 300-line one
      // needs more than 4096 tokens to come back, and a reply cut off
      // mid-function is applied as if it were the whole answer.
      max_tokens: limitsFor(gw.model).maxOutput,
      system,
      messages: [{ role: 'user', content: user }],
      stream: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    let detail = body.slice(0, 240);
    try { const j = JSON.parse(body); if (j?.error?.message) detail = j.error.message; } catch { /* raw body */ }
    if (res.status === 401) throw new Error(`The gateway rejected the API key. (${detail})`);
    if (res.status === 429) throw new Error(`Rate limited — wait a moment. (${detail})`);
    throw new Error(`Gateway ${res.status}: ${detail}`);
  }

  if (!res.headers.get('content-type')?.includes('text/event-stream') || !res.body) {
    const reply = await res.json();
    return (Array.isArray(reply.content) ? reply.content : [])
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { text: string }) => b.text).join('');
  }

  const decoder = new SSEDecoder();
  const asm = new TurnAssembler();
  const reader = res.body.getReader();
  const utf8 = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const ev of decoder.decode(utf8.decode(value, { stream: true }))) asm.push(ev, onText);
    }
  } finally {
    reader.releaseLock();
  }
  if (asm.error) throw new Error(asm.error);
  return asm.blocks().filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
}

export async function askEdit(
  gw: Gateway,
  req: EditRequest,
  onText: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const { system, user } = editMessages(req);
  const text = await askRaw(gw, system, user, onText, signal);
  return cleanEdit(text, req);
}
