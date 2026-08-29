import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { EditorState, type Extension, Compartment } from '@codemirror/state';
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
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
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
  if (ext === 'py') return [python()];
  if (ext === 'rs') return [rust()];
  if (ext === 'json') return [json()];
  if (['html', 'htm', 'vue', 'svelte'].includes(ext)) return [html()];
  if (['css', 'scss', 'less'].includes(ext)) return [css()];
  if (['md', 'markdown', 'mdx'].includes(ext)) return [markdown()];
  return [];   // plain text still gets numbers, search and editing
}

/**
 * Highlighting from the app's own tokens rather than a stock theme, so the
 * editor belongs to the window it is in. Only the roles that carry meaning are
 * coloured; painting every token turns code into confetti.
 */
function highlight(dark: boolean) {
  const c = dark
    ? { kw: '#C4A9FF', str: '#6BD6AE', num: '#E0AE5C', com: '#6B6880', fn: '#8FB8FF', type: '#6FD8DC', var: '#ECEAF5' }
    : { kw: '#6D3FA8', str: '#17694C', num: '#96620F', com: '#8B87A0', fn: '#23458F', type: '#0F6A72', var: '#16151D' };
  return HighlightStyle.define([
    { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword], color: c.kw },
    { tag: [t.string, t.special(t.string), t.regexp], color: c.str },
    { tag: [t.number, t.bool, t.null, t.atom], color: c.num },
    { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: c.com, fontStyle: 'italic' },
    { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName], color: c.fn },
    { tag: [t.typeName, t.className, t.namespace, t.tagName], color: c.type },
    { tag: [t.variableName, t.propertyName, t.attributeName], color: c.var },
    { tag: [t.heading], color: c.fn, fontWeight: 'bold' },
    { tag: [t.link, t.url], color: c.type, textDecoration: 'underline' },
    { tag: t.invalid, color: dark ? '#F0897C' : '#A8332A' },
  ]);
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
  onReady: (h: EditorHandle | null) => void;
  /** Fires whenever the dirty state changes, so tabs and the agent stay honest. */
  onDirty: (path: string, dirty: boolean) => void;
  onSaved: (path: string) => void;
  onError: (message: string) => void;
}

export function Editor({ root, path, visible, dark, line, complete, onReady, onDirty, onSaved, onError }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  /** sha-256 of what was last read from or written to disk. */
  const base = useRef<string>('');
  const clean = useRef<string>('');
  const dirtyNow = useRef(false);
  const themeC = useRef(new Compartment());
  const cb = useRef({ onDirty, onSaved, onError, complete });
  cb.current = { onDirty, onSaved, onError, complete };

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    let disposed = false;

    const extensions: Extension[] = [
      lineNumbers(), highlightActiveLineGutter(), foldGutter(), history(),
      drawSelection(), dropCursor(), EditorState.allowMultipleSelections.of(true),
      indentOnInput(), bracketMatching(), closeBrackets(), autocompletion(),
      rectangularSelection(), crosshairCursor(), highlightActiveLine(),
      highlightSelectionMatches(),
      keymap.of([
        ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap,
        ...historyKeymap, ...foldKeymap, ...completionKeymap, indentWithTab,
      ]),
      syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
      ...language(path),
      // Read through the ref so toggling completion in Settings takes effect on
      // files that are already open, without rebuilding the editor.
      inlineComplete(() => ({
        ...cb.current.complete(),
        path,
        language: languageName(path),
      })),
      themeC.current.of([theme(dark), syntaxHighlighting(highlight(dark))]),
      EditorView.updateListener.of((u) => {
        if (!u.docChanged) return;
        const now = u.state.doc.toString() !== clean.current;
        if (now !== dirtyNow.current) {
          dirtyNow.current = now;
          cb.current.onDirty(path, now);
        }
      }),
    ];

    const v = new EditorView({ state: EditorState.create({ doc: '', extensions }), parent: el });
    view.current = v;

    void invoke<string>('read_file', { root, path })
      .then(async (text) => {
        if (disposed) return;
        clean.current = text;
        base.current = await sha256Hex(text);
        v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } });
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
        const text = v.state.doc.toString();
        // The baseline is what this editor last saw on disk. Passing it means a
        // change made outside the app is reported rather than overwritten.
        await invoke('apply_write', { root, path, content: text, expectSha256: base.current });
        clean.current = text;
        base.current = await sha256Hex(text);
        dirtyNow.current = false;
        cb.current.onDirty(path, false);
        cb.current.onSaved(path);
      },
      goto: (n) => {
        const l = v.state.doc.line(Math.min(Math.max(1, n), v.state.doc.lines));
        v.dispatch({ selection: { anchor: l.from }, effects: EditorView.scrollIntoView(l.from, { y: 'center' }) });
        v.focus();
      },
      reload: async () => {
        const text = await invoke<string>('read_file', { root, path });
        clean.current = text;
        base.current = await sha256Hex(text);
        v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } });
        dirtyNow.current = false;
        cb.current.onDirty(path, false);
      },
    });

    return () => {
      disposed = true;
      onReady(null);
      view.current = null;
      v.destroy();
    };
    // Mount only: reloading because a prop changed would discard unsaved work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    view.current?.dispatch({
      effects: themeC.current.reconfigure([theme(dark), syntaxHighlighting(highlight(dark))]),
    });
  }, [dark]);

  useEffect(() => { if (visible) view.current?.focus(); }, [visible]);

  return <div className="ed" ref={host} style={{ display: visible ? 'block' : 'none' }} />;
}

export default Editor;
