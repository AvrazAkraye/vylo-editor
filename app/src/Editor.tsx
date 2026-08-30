import { explain } from './errors';
import { applyWrite } from './disk';
import { sha256Hex } from './hash';
import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { EditorState, Prec, type Extension, Compartment } from '@codemirror/state';
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
  drawSelection, dropCursor, rectangularSelection, crosshairCursor,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  bracketMatching, defaultHighlightStyle, foldGutter, foldKeymap, indentOnInput,
  syntaxHighlighting, HighlightStyle,
} from '@codemirror/language';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from '@codemirror/autocomplete';
import { tags as t } from '@lezer/highlight';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { rust } from '@codemirror/lang-rust';
import { json } from '@codemirror/lang-json';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { markdown } from '@codemirror/lang-markdown';
import { inlineComplete, type CompleteConfig } from './complete';
import {
  askEdit, cleanEdit, contextAround, editSize, fromInlineEdit, inlineEditState,
  pendingEdit, setPendingEdit, type Gateway,
} from './inline';
import { Icon } from './Icon';
import { setStaged, stagedPreview, type Staged } from './staged';
import { kindOf, loadGrammars } from './highlight';

/**
 * A real editor, replacing the read-only viewer.
 *
 * The viewer's old comment argued that editing here would be "a second, silent
 * way for files to change". The rule that was actually doing the work is about
 * who *authors* the change: review exists because the model is the untrusted
 * author, exactly as in the memory editor and the terminal. A human typing into
 * their own file is the author, and approving your own keystrokes is theatre.
 *
 * What editing does create is a collision the app never had before — a person
 * changing a file the agent has a diff staged against — and that is handled by
 * `expect_sha256` on `apply_write` rather than by refusing to edit.
 */

export interface EditorHandle {
  save(): Promise<void>;
  isDirty(): boolean;
  text(): string;
  reload(): Promise<void>;
  /** Jump to a line in a file that is already open. */
  goto(line: number): void;
  /** Where the caret is, 1-based. What the navigation trail records. */
  line(): number;
}

export function languageName(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx', mjs: 'javascript',
    cjs: 'javascript', py: 'python', rs: 'rust', json: 'json', html: 'html',
    htm: 'html', vue: 'vue', svelte: 'svelte', css: 'css', scss: 'scss',
    less: 'less', md: 'markdown', markdown: 'markdown', go: 'go', java: 'java',
    rb: 'ruby', php: 'php', sh: 'shell', sql: 'sql', yml: 'yaml', yaml: 'yaml',
    toml: 'toml', c: 'c', h: 'c', cpp: 'c++', cs: 'c#', swift: 'swift', kt: 'kotlin',
  };
  return map[ext] || ext || 'text';
}

function language(path: string): Extension[] {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext)) {
    return [javascript({ typescript: ext.startsWith('ts'), jsx: ext.endsWith('x') })];
  }
  // Everything else goes through the mapping the transcript highlighter uses,
  // so the editor and a code block in a reply cannot disagree about what a
  // `.pyi` or a `.jsonc` file is. JavaScript stays above because it is the one
  // that needs two flags rather than a name.
  switch (kindOf(ext)) {
    case 'py': return [python()];
    case 'rust': return [rust()];
    case 'json': return [json()];
    case 'html': return [html()];
    case 'css': return [css()];
    case 'md': return [markdown()];
    default: return [];   // plain text still gets numbers, search and editing
  }
}

/**
 * Highlighting from the app's own tokens rather than a stock theme, so the
 * editor belongs to the window it is in. Only the roles that carry meaning are
 * coloured; painting every token turns code into confetti.
 *
 * The colours are `--syn-*` custom properties rather than literals, which does
 * two things. It follows the theme through the same cascade as every other
 * colour, so this no longer has to be rebuilt when the theme changes; and it is
 * the same palette `highlight.ts` gives code blocks in the transcript, so the
 * two surfaces cannot drift into colouring a keyword differently.
 */
const SYNTAX = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword], color: 'var(--syn-kw)' },
  { tag: [t.string, t.special(t.string), t.regexp], color: 'var(--syn-str)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--syn-num)' },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: 'var(--syn-com)', fontStyle: 'italic' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName], color: 'var(--syn-fn)' },
  { tag: [t.typeName, t.className, t.namespace, t.tagName], color: 'var(--syn-type)' },
  { tag: [t.variableName, t.propertyName, t.attributeName], color: 'var(--syn-var)' },
  { tag: [t.heading], color: 'var(--syn-fn)', fontWeight: 'bold' },
  { tag: [t.link, t.url], color: 'var(--syn-type)', textDecoration: 'underline' },
  { tag: t.invalid, color: 'var(--syn-bad)' },
]);

/**
 * The identifier under the caret, or the selection when there is one.
 *
 * A selection wins because selecting the thing you mean is the unambiguous
 * gesture, and `wordAt` on the caret inside a selection would silently look up
 * something else.
 */
function wordAtCaret(view: EditorView): string | null {
  const sel = view.state.selection.main;
  if (!sel.empty) return view.state.sliceDoc(sel.from, sel.to).trim() || null;
  const w = view.state.wordAt(sel.head);
  return w ? view.state.sliceDoc(w.from, w.to) : null;
}

function theme(dark: boolean) {
  return EditorView.theme({
    '&': { height: '100%', fontSize: '12.5px', backgroundColor: 'var(--bg)', color: 'var(--ink)' },
    '.cm-scroller': {
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      lineHeight: '1.55',
    },
    '.cm-gutters': { backgroundColor: 'var(--bg)', color: 'var(--mute)', border: 'none' },
    '.cm-activeLineGutter': { backgroundColor: 'var(--panel-2)', color: 'var(--ink-2)' },
    '.cm-activeLine': { backgroundColor: 'var(--panel-2)' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--brand)', borderLeftWidth: '2px' },
    '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
      backgroundColor: 'var(--brand-wash)',
    },
    '.cm-selectionMatch': { backgroundColor: 'var(--panel-3)' },
    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
      backgroundColor: 'var(--panel-3)', outline: '1px solid var(--rule-2)',
    },
    '.cm-tooltip': {
      backgroundColor: 'var(--panel)', border: '1px solid var(--rule-2)',
      borderRadius: '8px', color: 'var(--ink)',
    },
    '.cm-tooltip-autocomplete ul li[aria-selected]': {
      backgroundColor: 'var(--brand-wash)', color: 'var(--ink)',
    },
    '.cm-panels': { backgroundColor: 'var(--panel-2)', color: 'var(--ink)' },
  }, { dark });
}

interface Props {
  root: string;
  path: string;
  visible: boolean;
  dark: boolean;
  /** Scroll here on open, when arriving from a search hit. */
  line?: number;
  /** Gateway settings for inline completion, read fresh on every request. */
  complete: () => Omit<CompleteConfig, 'path' | 'language'>;
  /** Gateway settings and project memory for ⌘K. */
  edit: () => Gateway & { memory: string };
  /** The agent's proposal for this file, drawn over it. Null when there is none. */
  staged: Staged | null;
  /** Load the recovered draft for this file instead of what is on disk. */
  recover?: boolean;
  t: (s: string) => string;
  onReady: (h: EditorHandle | null) => void;
  /** Fires whenever the dirty state changes, so tabs and the agent stay honest. */
  onDirty: (path: string, dirty: boolean) => void;
  onSaved: (path: string) => void;
  onError: (message: string) => void;
  /**
   * F12, or ⌘-click, on an identifier. The editor knows the word; where that
   * word is declared is a question for the project index, which lives up in
   * App — so this hands over the name and nothing else.
   */
  onDefinition: (name: string) => void;
}

export function Editor({
  root, path, visible, dark, line, complete, edit, staged, recover, t,
  onReady, onDirty, onSaved, onError, onDefinition,
}: Props) {
  /** The ⌘K bar: where it sits, what was selected, and what came back. */
  const [ask, setAsk] = useState<{ from: number; to: number; top: number } | null>(null);
  const [instruction, setInstruction] = useState('');
  const [running, setRunning] = useState(false);
  const [streamed, setStreamed] = useState('');
  const [askError, setAskError] = useState<string | null>(null);
  const [applied, setApplied] = useState<{ added: number; removed: number } | null>(null);
  const abort = useRef<AbortController | null>(null);
  const prompt = useRef<HTMLInputElement>(null);
  /**
   * Whether the proposal can be drawn where it belongs.
   *
   * It cannot once the file has been edited since it was staged, because the
   * line numbers then mean something else. The decorations vanish on their own
   * in that case, and a preview that silently disappears is confusing — so the
   * banner says which of the two situations you are in.
   */
  const [fits, setFits] = useState<boolean | null>(null);
  /** Set when the file was too large to load whole. The buffer is a prefix. */
  const [partial, setPartial] = useState<{ bytes: number } | null>(null);
  const partialRef = useRef(false);
  const draftTimer = useRef<number | undefined>(undefined);
  const stagedRef = useRef<Staged | null>(null);
  stagedRef.current = staged;

  const cfg = useRef({ edit, t });
  cfg.current = { edit, t };
  // The keymap is built once at mount, so it reaches the handlers through a ref
  // rather than closing over the first render's versions of them.
  const acts = useRef<{ keep: () => void; undo: () => void }>({ keep: () => {}, undo: () => {} });
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  /** sha-256 of what was last read from or written to disk. */
  const base = useRef<string>('');
  const clean = useRef<string>('');
  const dirtyNow = useRef(false);
  const themeC = useRef(new Compartment());
  const readOnlyC = useRef(new Compartment());
  const cb = useRef({ onDirty, onSaved, onError, complete, onDefinition });
  cb.current = { onDirty, onSaved, onError, complete, onDefinition };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;
    // The staged and ⌘K previews highlight the moment they appear, with no
    // chance to wait. The chunk is already in memory here — Editor imports the
    // same grammars — so this only populates the table highlight.ts reads.
    void loadGrammars();

    const extensions: Extension[] = [
      lineNumbers(), highlightActiveLineGutter(), foldGutter(), history(),
      drawSelection(), dropCursor(), EditorState.allowMultipleSelections.of(true),
      indentOnInput(), bracketMatching(), closeBrackets(), autocompletion(),
      rectangularSelection(), crosshairCursor(), highlightActiveLine(),
      highlightSelectionMatches(),
      Prec.high(keymap.of([
        {
          // Escape and Mod-Enter only mean anything while a preview is up, and
          // return false otherwise so they keep their usual behaviour.
          key: 'Escape',
          run: (view) => {
            if (!view.state.field(pendingEdit, false)) return false;
            acts.current.undo();
            return true;
          },
        },
        {
          key: 'Mod-Enter',
          run: (view) => {
            if (!view.state.field(pendingEdit, false)) return false;
            acts.current.keep();
            return true;
          },
        },
        {
          // F12 is the binding every editor has for this, and it collides with
          // nothing here. `wordAt` is CodeMirror's own idea of a word, so what
          // counts as an identifier follows the language rather than a regex.
          key: 'F12',
          run: (view) => {
            const word = wordAtCaret(view);
            if (!word) return false;
            cb.current.onDefinition(word);
            return true;
          },
        },
        {
          key: 'Mod-k',
          run: (view) => {
            const sel = view.state.selection.main;
            // coordsAtPos is viewport-relative; the bar is positioned inside the
            // scroller, so the scroll offset has to come back out.
            const at = view.coordsAtPos(sel.from);
            const box = view.scrollDOM.getBoundingClientRect();
            const top = at ? at.top - box.top + view.scrollDOM.scrollTop : 0;
            setAsk({ from: sel.from, to: sel.to, top: Math.max(0, top) });
            setInstruction('');
            setStreamed('');
            setAskError(null);
            setApplied(null);
            window.setTimeout(() => prompt.current?.focus(), 0);
            return true;
          },
        },
      ])),
      keymap.of([
        ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap,
        ...historyKeymap, ...foldKeymap, ...completionKeymap, indentWithTab,
      ]),
      // ⌘-click, the other half of the same gesture. `mousedown` rather than
      // `click`: by the time a click fires the selection has already moved, and
      // a modifier-click in CodeMirror starts a second cursor — which is what
      // rectangularSelection and multiple selections are for, and not what was
      // meant here.
      EditorView.domEventHandlers({
        mousedown: (event, view) => {
          if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return false;
          if (event.button !== 0) return false;
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (pos === null) return false;
          const w = view.state.wordAt(pos);
          if (!w) return false;
          event.preventDefault();
          cb.current.onDefinition(view.state.sliceDoc(w.from, w.to));
          return true;
        },
      }),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      inlineEditState,
      stagedPreview,
      ...language(path),
      // Read through the ref so toggling completion in Settings takes effect on
      // files that are already open, without rebuilding the editor.
      inlineComplete(() => ({
        ...cb.current.complete(),
        path,
        language: languageName(path),
      })),
      themeC.current.of([theme(dark), syntaxHighlighting(SYNTAX)]),
      readOnlyC.current.of([]),
      EditorView.updateListener.of((u) => {
        if (!u.docChanged) return;
        const st = stagedRef.current;
        setFits(st ? u.state.doc.toString() === st.before : null);
        const now = u.state.doc.toString() !== clean.current;
        if (now !== dirtyNow.current) {
          dirtyNow.current = now;
          cb.current.onDirty(path, now);
        }
        // Kept outside the process holding it, so a crash does not take it.
        // Debounced: a draft per keystroke would be a write per keystroke.
        window.clearTimeout(draftTimer.current);
        if (now) {
          draftTimer.current = window.setTimeout(() => {
            void invoke('draft_save', {
              root, path, text: v.state.doc.toString(), base: base.current,
            }).catch(() => { /* a lost draft is not worth interrupting typing for */ });
          }, 1200);
        } else {
          void invoke('draft_clear', { root, path }).catch(() => {});
        }
      }),
    ];

    const v = new EditorView({ state: EditorState.create({ doc: '', extensions }), parent: el });
    view.current = v;

    void invoke<{ text: string; truncated: boolean; bytes: number }>('read_for_editor', { root, path })
      .then(async ({ text, truncated, bytes }) => {
        if (disposed) return;
        if (truncated) {
          partialRef.current = true;
          setPartial({ bytes });
          // Read-only is what makes showing a prefix safe. Saving a buffer that
          // holds the first 2 MB of a larger file would write those 2 MB over
          // the whole thing and silently destroy the rest.
          v.dispatch({ effects: readOnlyC.current.reconfigure(EditorState.readOnly.of(true)) });
        }
        clean.current = text;
        base.current = await sha256Hex(text);

        // A recovered draft replaces the text but not the baseline: `clean` and
        // `base` stay as what is on disk, so the buffer is correctly dirty
        // against it and the save guard still compares against the real file.
        let shown = text;
        if (recover) {
          const draft = await invoke<string | null>('draft_read', { root, path });
          if (draft !== null && draft !== undefined && draft !== text) {
            shown = draft;
            partialRef.current = false;
            dirtyNow.current = true;
            cb.current.onDirty(path, true);
          }
        }

        v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: shown } });
        if (line) {
          const l = v.state.doc.line(Math.min(Math.max(1, line), v.state.doc.lines));
          v.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: 'center' }) });
        }
      })
      .catch((e) => { if (!disposed) cb.current.onError(String(e)); });

    onReady({
      isDirty: () => dirtyNow.current,
      text: () => v.state.doc.toString(),
      save: async () => {
        // Belt as well as braces: the view is read-only, but a save reaching
        // here anyway would truncate the file on disk.
        if (partialRef.current) {
          throw new Error(cfg.current.t('This file is too large to edit here, so it cannot be saved.'));
        }
        const text = v.state.doc.toString();
        // The baseline is what this editor last saw on disk. Passing it means a
        // change made outside the app is reported rather than overwritten.
        await applyWrite(root, path, text, base.current);
        clean.current = text;
        base.current = await sha256Hex(text);
        dirtyNow.current = false;
        cb.current.onDirty(path, false);
        // Saved is the one moment a draft is certainly no longer wanted.
        void invoke('draft_clear', { root, path }).catch(() => {});
        cb.current.onSaved(path);
      },
      line: () => v.state.doc.lineAt(v.state.selection.main.head).number,
      goto: (n) => {
        const l = v.state.doc.line(Math.min(Math.max(1, n), v.state.doc.lines));
        v.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: 'center' }) });
        v.focus();
      },
      reload: async () => {
        // Same tolerant read as the initial load, or reloading a large file
        // after a checkpoint restore would fail where opening it worked.
        const { text } = await invoke<{ text: string }>('read_for_editor', { root, path });
        clean.current = text;
        base.current = await sha256Hex(text);
        v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } });
        dirtyNow.current = false;
        cb.current.onDirty(path, false);
      },
    });

    return () => {
      disposed = true;
      window.clearTimeout(draftTimer.current);
      onReady(null);
      view.current = null;
      v.destroy();
    };
    // Mount only: reloading because a prop changed would discard unsaved work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    view.current?.dispatch({
      effects: themeC.current.reconfigure([theme(dark), syntaxHighlighting(SYNTAX)]),
    });
  }, [dark]);

  // Pushed in rather than read out: the proposal lives in `Pending`, and the
  // editor only ever draws it.
  useEffect(() => {
    const v = view.current;
    v?.dispatch({ effects: setStaged.of(staged) });
    setFits(staged && v ? v.state.doc.toString() === staged.before : null);
  }, [staged]);

  useEffect(() => { if (visible) view.current?.focus(); }, [visible]);

  /** Send the region and its surroundings, then apply the result in one go. */
  async function run() {
    const v = view.current;
    if (!v || !ask || !instruction.trim()) return;
    const gw = cfg.current.edit();
    if (!gw.apiKey) { setAskError(cfg.current.t('Add your gateway API key in Settings.')); return; }

    const doc = v.state.doc.toString();
    const selection = doc.slice(ask.from, ask.to);
    const { before, after } = contextAround(doc, ask.from, ask.to);
    const controller = new AbortController();
    abort.current = controller;
    setRunning(true);
    setStreamed('');
    setAskError(null);

    try {
      const result = await askEdit(
        gw,
        { path, language: languageName(path), before, selection, after, instruction: instruction.trim(), memory: gw.memory },
        (chunk) => setStreamed((p) => p + chunk),
        controller.signal,
      );
      const text = cleanEdit(result, { before, after });
      if (!text) { setAskError(cfg.current.t('The model returned nothing to insert.')); return; }
      if (text === selection) { setAskError(cfg.current.t('That would not change anything.')); return; }

      // One transaction, so undo is a single step rather than one per token,
      // and so the preview state and the text land together.
      v.dispatch({
        changes: { from: ask.from, to: ask.to, insert: text },
        selection: { anchor: ask.from + text.length },
        effects: setPendingEdit.of({ from: ask.from, to: ask.from + text.length, original: selection, path }),
        annotations: fromInlineEdit.of(true),
      });
      setApplied(editSize(selection, text));
      setAsk(null);
      v.focus();
    } catch (e) {
      if (!controller.signal.aborted) {
        setAskError(explain(e, cfg.current.t('rewrite that selection')));
      }
    } finally {
      abort.current = null;
      setRunning(false);
    }
  }

  /** Keep it. The preview text is already the buffer, so this only clears state. */
  function keep() {
    const v = view.current;
    v?.dispatch({ effects: setPendingEdit.of(null), annotations: fromInlineEdit.of(true) });
    setApplied(null);
    v?.focus();
  }

  /** Put the original back, exactly. */
  function undo() {
    const v = view.current;
    const p = v?.state.field(pendingEdit, false);
    if (!v || !p) { setApplied(null); return; }
    v.dispatch({
      changes: { from: p.from, to: Math.min(p.to, v.state.doc.length), insert: p.original },
      selection: { anchor: p.from },
      effects: setPendingEdit.of(null),
      annotations: fromInlineEdit.of(true),
    });
    setApplied(null);
    v.focus();
  }

  function cancel() {
    abort.current?.abort();
    setAsk(null);
    setRunning(false);
    view.current?.focus();
  }

  acts.current = { keep, undo };
  const T = cfg.current.t;

  return (
    <div className="ed-wrap" style={{ display: visible ? 'flex' : 'none' }}>
      <div className="ed" ref={host} />

      {partial && (
        <div className="staged-bar stale">
          <Icon name="warning" size={13} />
          <span>
            {T('Showing the first 2 MB of this file.')}{' '}
            {T('It is too large to edit here, so it is read-only —')}{' '}
            {(partial.bytes / 1048576).toFixed(1)} MB {T('in total')}.
          </span>
        </div>
      )}

      {staged && (
        <div className={`staged-bar ${fits === false ? 'stale' : ''}`}>
          <Icon name={fits === false ? 'warning' : 'diff'} size={13} />
          <span>
            {fits === false
              ? T('This file changed since the proposal, so it cannot be shown in place. The review panel still has it.')
              : T('Proposed change shown in place — nothing is written until you approve it below.')}
          </span>
        </div>
      )}

      {ask && (
        <div className="kbar" style={{ top: ask.top }}>
          <div className="kbar-in">
            <Icon name="sparkle" size={14} />
            <input
              ref={prompt}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') { e.preventDefault(); cancel(); }
                else if (e.key === 'Enter') { e.preventDefault(); void run(); }
              }}
              placeholder={ask.from === ask.to ? T('Describe what to write here…') : T('Describe the change…')}
              disabled={running}
              spellCheck={false}
            />
            {running ? (
              <button className="ghost" onClick={cancel}>{T('Stop')}</button>
            ) : (
              <button className="approve" onClick={() => void run()} disabled={!instruction.trim()}>
                {T('Rewrite')}
              </button>
            )}
          </div>
          {running && (
            <div className="kbar-note">
              {/* The token count is honest progress: a line count would jump
                  around as the model rewrites its own indentation mid-stream. */}
              {T('Writing…')} {streamed.length > 0 && `${streamed.length} ${T('characters')}`}
            </div>
          )}
          {askError && <div className="kbar-note err">{askError}</div>}
        </div>
      )}

      {applied && (
        <div className="kdone">
          <span className="kd-stat">
            <span className="add">+{applied.added}</span>
            <span className="del">−{applied.removed}</span>
          </span>
          <span className="kd-note">{T('Not saved yet.')}</span>
          <button className="ghost" onClick={undo}>{T('Undo')} <kbd>Esc</kbd></button>
          <button className="approve" onClick={keep}>{T('Keep')}</button>
        </div>
      )}
    </div>
  );
}

export default Editor;
