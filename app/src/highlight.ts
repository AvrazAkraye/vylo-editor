/**
 * Syntax highlighting for code the editor is not showing.
 *
 * The agent's replies are full of code and the transcript rendered all of it as
 * undifferentiated monospace, so a fifty-line proposal had to be read a
 * character at a time. The editor two panes away highlights the same language
 * properly, which made the chat look like the part of the app nobody finished.
 *
 * ## Why this is not the editor's highlighting
 *
 * CodeMirror highlights a *document* it owns. A code block in a reply is a
 * string, and mounting an editor per block to colour it would cost a view, a
 * state and a DOM tree each — for text nobody can edit. What is actually needed
 * is the parser underneath, which is separable: parse the string, walk the
 * tree, emit spans.
 *
 * ## Why the grammars load late
 *
 * The seven Lezer grammars are a few hundred kilobytes of parser tables. The
 * editor already pays for them and is lazy-loaded for exactly that reason, so
 * loading them eagerly here would move that weight into the first paint of an
 * app that might only ever be used for chat. `highlight` therefore answers
 * immediately with plain text until `loadGrammars()` has resolved, and the
 * caller re-renders when it has. A block appears unhighlighted for one frame
 * rather than the window appearing later.
 *
 * ## The classes match the editor's
 *
 * The groups here are the same groups `Editor.tsx` colours, and both take their
 * colours from the same `--syn-*` custom properties. Two highlighters that
 * disagree about what a keyword is would be worse than one that does not
 * highlight at all.
 */

import type { Highlighter } from '@lezer/highlight';
import type { Parser } from '@lezer/common';

/** A language this app can parse. Kept as a name so the mapping is data. */
export type Kind = 'js' | 'ts' | 'py' | 'rust' | 'json' | 'html' | 'css' | 'md';

/**
 * File extension to language.
 *
 * `Editor.tsx` chooses its CodeMirror extensions from this same function, so
 * the editor and the transcript cannot drift into disagreeing about what a
 * `.mts` file is.
 */
export function kindOf(ext: string): Kind | null {
  switch (ext) {
    case 'js': case 'jsx': case 'mjs': case 'cjs': case 'javascript': case 'node':
      return 'js';
    case 'ts': case 'tsx': case 'mts': case 'cts': case 'typescript':
      return 'ts';
    case 'py': case 'python': case 'pyi':
      return 'py';
    case 'rs': case 'rust':
      return 'rust';
    case 'json': case 'jsonc': case 'json5':
      return 'json';
    case 'html': case 'htm': case 'vue': case 'svelte': case 'xml':
      return 'html';
    case 'css': case 'scss': case 'less':
      return 'css';
    case 'md': case 'markdown': case 'mdx':
      return 'md';
    default:
      return null;
  }
}

/**
 * The language a fence info string names.
 *
 * A fence says `ts`, or `tsx`, or `python`, or — often, because a reply is
 * about a particular file — `src/App.tsx`. Taking the extension of the first
 * word covers all three, and anything else falls through to plain text, which
 * is the correct failure: uncoloured code is readable, miscoloured code is not.
 */
export function kindOfInfo(info: string): Kind | null {
  const first = (info.trim().split(/[\s,;{]+/)[0] ?? '').toLowerCase();
  const bare = first.replace(/^\.+/, '');
  const dot = bare.lastIndexOf('.');
  return kindOf(dot > 0 ? bare.slice(dot + 1) : bare);
}

/**
 * The tag groups, built at load time rather than at module scope.
 *
 * Everything from @lezer/highlight is imported inside `loadGrammars` for the
 * same reason the grammars are: `@lezer/highlight` pulls in `@lezer/common`,
 * which is another forty kilobytes an app used only for chat would download
 * before its first paint. Statically importing just the tag list here cost 13kB
 * gzipped in the entry chunk, measured — enough to be worth the indirection.
 *
 * The groups mirror `SYNTAX` in `Editor.tsx` exactly. Not `classHighlighter`
 * from @lezer/highlight: its class set has no entry for a function name, so `f`
 * in `function f()` would come back as an ordinary variable and the transcript
 * would colour something the editor does not.
 */
type HighlightTree = (tree: unknown, hl: Highlighter,
                      put: (from: number, to: number, cls: string) => void) => void;

let parsers: Partial<Record<Kind, Parser>> | null = null;
let highlighter: Highlighter | null = null;
let walk: HighlightTree | null = null;
let loading: Promise<void> | null = null;

/** Whether a call to `highlight` can colour anything yet. */
export const grammarsReady = () => parsers !== null;

/**
 * Load the grammars, once.
 *
 * Every caller shares the one promise, so ten code blocks arriving together
 * fetch the chunk once rather than ten times. A failure is swallowed to an
 * empty set: highlighting is decoration, and a transcript that will not render
 * because a parser table failed to download is a far worse outcome than one
 * rendered in a single colour.
 */
export function loadGrammars(): Promise<void> {
  if (parsers) return Promise.resolve();
  if (!loading) {
    loading = (async () => {
      try {
        const [hl, js, py, rs, jsn, htm, cs, md] = await Promise.all([
          import('@lezer/highlight'),
          import('@codemirror/lang-javascript'),
          import('@codemirror/lang-python'),
          import('@codemirror/lang-rust'),
          import('@codemirror/lang-json'),
          import('@codemirror/lang-html'),
          import('@codemirror/lang-css'),
          import('@codemirror/lang-markdown'),
        ]);
        const t = hl.tags;
        walk = hl.highlightTree as unknown as HighlightTree;
        highlighter = hl.tagHighlighter([
          { tag: [t.keyword, t.modifier, t.controlKeyword, t.operatorKeyword], class: 'syn-kw' },
          { tag: [t.string, t.special(t.string), t.regexp], class: 'syn-str' },
          { tag: [t.number, t.bool, t.null, t.atom], class: 'syn-num' },
          { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], class: 'syn-com' },
          { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName], class: 'syn-fn' },
          { tag: [t.typeName, t.className, t.namespace, t.tagName], class: 'syn-type' },
          { tag: [t.variableName, t.propertyName, t.attributeName], class: 'syn-var' },
          { tag: [t.heading], class: 'syn-head' },
          { tag: [t.link, t.url], class: 'syn-link' },
          { tag: t.invalid, class: 'syn-bad' },
        ]);
        parsers = {
          js: js.javascript({ jsx: true }).language.parser,
          ts: js.javascript({ typescript: true, jsx: true }).language.parser,
          py: py.python().language.parser,
          rust: rs.rust().language.parser,
          json: jsn.json().language.parser,
          html: htm.html().language.parser,
          css: cs.css().language.parser,
          md: md.markdown().language.parser,
        };
      } catch {
        parsers = {};
      }
    })();
  }
  return loading;
}

/** A run of code sharing one class. `cls` is empty for untagged text. */
export interface Span {
  text: string;
  cls: string;
}

/**
 * Above this, highlighting is skipped.
 *
 * A reply should not contain a ten-thousand-line block, and if one does, the
 * cost of parsing it lands on every keystroke of the reply still streaming
 * below it. Plain text is the right answer for something that large.
 */
const MAX_CHARS = 100_000;

/**
 * Results are cached because the transcript re-renders on every streamed token.
 * The key is the code itself, so a block that has stopped changing is parsed
 * once however many deltas arrive after it.
 */
const CACHE = new Map<string, Span[]>();
const CACHE_MAX = 80;

export function highlight(code: string, info: string): Span[] {
  if (!code) return [];
  const plain = [{ text: code, cls: '' }];
  const kind = kindOfInfo(info);
  if (!kind || code.length > MAX_CHARS) return plain;
  const parser = parsers?.[kind];
  if (!parser || !highlighter || !walk) return plain;

  const key = `${kind} ${code}`;
  const hit = CACHE.get(key);
  if (hit) return hit;

  const out: Span[] = [];
  let at = 0;
  try {
    walk(parser.parse(code), highlighter, (from, to, cls) => {
      // highlightTree only reports the ranges it has a class for; everything
      // between them is ordinary code and has to be filled in here.
      if (from > at) out.push({ text: code.slice(at, from), cls: '' });
      out.push({ text: code.slice(from, to), cls });
      at = to;
    });
  } catch {
    // A grammar can throw on input it cannot recover from. Half-coloured code
    // is worse than none, so the block falls back whole.
    return plain;
  }
  if (at < code.length) out.push({ text: code.slice(at), cls: '' });

  if (CACHE.size >= CACHE_MAX) {
    // Insertion-ordered, so the first key is the oldest. One eviction per
    // insert keeps it at the cap without a second data structure.
    const oldest = CACHE.keys().next().value;
    if (oldest !== undefined) CACHE.delete(oldest);
  }
  CACHE.set(key, out);
  return out;
}

/**
 * The same spans, split one array per line.
 *
 * A diff is rendered line by line, and a line parsed on its own is not the same
 * text: a method body is not a program, `}` alone is a syntax error, and a line
 * inside a template literal is prose. So the whole document is parsed once and
 * the result is cut up afterwards — which is also why a diff needs both sides
 * parsed, not the rows.
 *
 * Always `code.split('\n').length` entries, so a line number indexes it
 * directly. A span crossing a newline — a block comment, a template literal —
 * is divided and keeps its class on both sides.
 */
export function highlightLines(code: string, info: string): Span[][] {
  const out: Span[][] = [[]];
  for (const span of highlight(code, info)) {
    let rest = span.text;
    for (;;) {
      const nl = rest.indexOf('\n');
      if (nl === -1) {
        if (rest) out[out.length - 1].push({ text: rest, cls: span.cls });
        break;
      }
      if (nl > 0) out[out.length - 1].push({ text: rest.slice(0, nl), cls: span.cls });
      out.push([]);
      rest = rest.slice(nl + 1);
    }
  }
  return out;
}
