import { StateEffect, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, WidgetType } from '@codemirror/view';
import { diffRows, type Row } from './pending';
import { highlightLines, spansToDOM, type Span } from './highlight';

/**
 * The agent's staged proposal, drawn over the open file.
 *
 * The review pane at the foot of the window shows the diff, but not where in
 * the file it lands or what surrounds it. Seeing a proposal in place, in the
 * code you were already reading, is most of what makes it possible to judge.
 *
 * ## The buffer is never touched
 *
 * The obvious implementation puts the proposed text *into* the editor and marks
 * it up, which is what ⌘K does. That is wrong here, for two reasons: the buffer
 * would be dirty against disk, so saving would write the agent's proposal
 * without it ever passing the review gate; and rejecting the change in the
 * review pane would leave the editor still holding it.
 *
 * So the buffer keeps showing what is on disk, and the proposal is decoration
 * on top: lines that would go are struck through where they actually are, and
 * lines that would arrive appear as widgets between them. Rejecting removes
 * some styling and nothing else.
 */

export interface Marks {
  /** 1-based buffer lines the change would remove. */
  removed: number[];
  /**
   * Lines the change would add, anchored after a buffer line (0 = at the top).
   *
   * `from` is where the run starts in the *proposed* file, which the buffer
   * does not contain. It is what lets the added lines be highlighted: they have
   * to be parsed as part of the document they belong to, not on their own.
   */
  added: { after: number; from: number; lines: string[] }[];
}

/**
 * Where a diff lands in the *current* buffer.
 *
 * Row `a` numbers are positions in `before`, and `before` is what the buffer
 * holds, so they can be used directly. Added lines have no `a` at all — they do
 * not exist yet — so each run is anchored to the last line that did.
 */
export function stagedMarks(rows: Row[]): Marks {
  const removed: number[] = [];
  const added: { after: number; from: number; lines: string[] }[] = [];
  let anchor = 0;
  let run: string[] = [];
  let runFrom = 0;

  const flush = () => {
    if (run.length) { added.push({ after: anchor, from: runFrom, lines: run }); run = []; }
  };

  for (const r of rows) {
    if (r.kind === '+') {
      if (!run.length) runFrom = r.b ?? 0;
      run.push(r.text);
      continue;
    }
    flush();
    if (r.a !== undefined) anchor = r.a;
    if (r.kind === '-') removed.push(r.a ?? anchor);
  }
  flush();
  return { removed, added };
}

class AddedWidget extends WidgetType {
  constructor(readonly lines: string[], readonly spans: Span[][]) { super(); }
  /**
   * Same lines *and* the same idea of whether they are coloured.
   *
   * The grammars load on demand, so a widget can be built before they arrive
   * and would otherwise never be rebuilt — comparing only the text would leave
   * the one block on screen that stayed grey.
   */
  eq(o: AddedWidget) {
    return o.lines.join('\n') === this.lines.join('\n') && coloured(o.spans) === coloured(this.spans);
  }
  toDOM() {
    const box = document.createElement('div');
    box.className = 'cm-staged-add';
    this.lines.forEach((line, i) => box.appendChild(spansToDOM(this.spans[i], line)));
    return box;
  }
  ignoreEvent() { return true; }
}

const coloured = (spans: Span[][]) => spans.some((l) => l.some((s) => s.cls));

/** `path` only names the language; nothing here reads the file. */
export interface Staged { before: string; after: string; path: string }

export const setStaged = StateEffect.define<Staged | null>();

const stagedField = StateField.define<Staged | null>({
  create: () => null,
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setStaged)) return e.value;
    return value;
  },
});

// `doc` is a dependency, not decoration: a facet computation runs again only
// when something it declares has changed, so without it the check below —
// "the buffer still says what the proposal was built against" — would never be
// re-evaluated after an edit, and the decorations would stay drawn at line
// numbers that had moved underneath them.
const decorations = EditorView.decorations.compute(['doc', stagedField], (state) => {
  const s = state.field(stagedField, false);
  if (!s) return Decoration.none;

  // Only draw when the buffer still says what the proposal was built against.
  // Once someone edits the file the line numbers mean something else, and a
  // diff drawn at the wrong lines is worse than no diff at all.
  const doc = state.doc.toString();
  if (doc !== s.before) return Decoration.none;

  const marks = stagedMarks(diffRows(s.before, s.after));
  // The proposed file, parsed whole. The added lines are lines *of it*, and a
  // line parsed on its own is not the same text.
  const proposed = highlightLines(s.after, s.path);
  const out = [];
  for (const n of marks.removed) {
    if (n >= 1 && n <= state.doc.lines) {
      out.push(Decoration.line({ class: 'cm-staged-del' }).range(state.doc.line(n).from));
    }
  }
  for (const group of marks.added) {
    const at = group.after === 0
      ? 0
      : state.doc.line(Math.min(group.after, state.doc.lines)).to;
    out.push(
      Decoration.widget({
        widget: new AddedWidget(group.lines, proposed.slice(group.from - 1, group.from - 1 + group.lines.length)),
        block: true,
        side: 1,
      }).range(at),
    );
  }
  return Decoration.set(out, true);
});

export const stagedPreview: Extension = [
  stagedField,
  decorations,
  EditorView.baseTheme({
    '.cm-staged-del': {
      backgroundColor: 'var(--err-wash, rgba(168,51,42,.10))',
      textDecoration: 'line-through',
      textDecorationColor: 'var(--err, #A8332A)',
    },
    '.cm-staged-add': {
      backgroundColor: 'var(--ok-wash, rgba(23,105,76,.12))',
      borderLeft: '2px solid var(--ok, #17694C)',
      padding: '0 0 0 6px',
    },
  }),
];
