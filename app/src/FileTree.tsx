import { useMemo, useState } from 'react';
import { Icon } from './Icon';
import { DRAG_PATH, carry } from './paste';
import { fill } from './i18n';

export interface Entry { path: string; is_dir: boolean; size: number }

interface Node {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  children: Node[];
}

/**
 * `list_tree` returns a flat list of relative paths; this rebuilds the shape.
 *
 * Directories are materialised from the paths themselves rather than trusted to
 * appear as their own entries — the walker's cap can truncate mid-directory, and
 * a file whose parent never arrived should still be reachable rather than
 * silently missing from the tree.
 */
function build(entries: Entry[]): Node[] {
  const root: Node = { name: '', path: '', isDir: true, size: 0, children: [] };
  const dirs = new Map<string, Node>([['', root]]);

  const ensureDir = (path: string): Node => {
    const found = dirs.get(path);
    if (found) return found;
    const cut = path.lastIndexOf('/');
    const parent = ensureDir(cut === -1 ? '' : path.slice(0, cut));
    const node: Node = {
      name: cut === -1 ? path : path.slice(cut + 1),
      path, isDir: true, size: 0, children: [],
    };
    parent.children.push(node);
    dirs.set(path, node);
    return node;
  };

  for (const e of entries) {
    const p = e.path.replace(/\\/g, '/');
    if (e.is_dir) { ensureDir(p); continue; }
    const cut = p.lastIndexOf('/');
    ensureDir(cut === -1 ? '' : p.slice(0, cut)).children.push({
      name: cut === -1 ? p : p.slice(cut + 1),
      path: p, isDir: false, size: e.size, children: [],
    });
  }

  const sort = (n: Node): void => {
    n.children.sort((a, b) =>
      a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1);
    n.children.forEach(sort);
  };
  sort(root);
  return root.children;
}

const ICONS: Record<string, string> = {
  ts: 'TS', tsx: 'TS', js: 'JS', jsx: 'JS', json: '{}', rs: 'RS',
  py: 'PY', go: 'GO', java: 'JV', rb: 'RB', php: 'PHP', sh: '$',
  css: '#', scss: '#', html: '<>', md: 'M', yml: 'Y', yaml: 'Y',
  toml: 'T', sql: 'DB', png: 'IMG', jpg: 'IMG', jpeg: 'IMG', svg: 'IMG', gif: 'IMG',
};
const iconFor = (name: string) => ICONS[name.split('.').pop()?.toLowerCase() || ''] || '·';

interface Props {
  entries: Entry[];
  openPath: string | null;
  onOpen: (path: string) => void;
  /** Paths with staged edits, marked so pending work is visible in context. */
  changed: Set<string>;
  onRename: (path: string) => void;
  onDelete: (path: string, isDir: boolean) => void;
  /** New file inside a folder, so the path is prefilled with where you clicked. */
  onNewIn: (dir: string) => void;
  /**
   * Right-click, with the point to open at.
   *
   * The row already carries three hover buttons and the reasoning for that is
   * sound — but copying a path is the thing people want from a file tree most
   * often after opening one, and a fourth icon in a 22px row is a fourth thing
   * to miss. It goes in a menu, where people already look for it.
   */
  onMenu?: (path: string, isDir: boolean, at: { x: number; y: number }) => void;
  /**
   * This component took no translator at all, so the explorer — the panel that
   * is open the whole time — was the one part of the interface still speaking
   * English inside a right-to-left one: three button labels, the staged-changes
   * marker, and its empty state.
   */
  t: (s: string) => string;
}

export function FileTree({ entries, openPath, onOpen, changed, onRename, onDelete, onNewIn, onMenu, t }: Props) {
  const tree = useMemo(() => build(entries), [entries]);
  // Top level starts open; everything deeper starts closed, so a big repo does
  // not unfold into thousands of rows on first sight.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(tree.filter((n) => n.isDir).slice(0, 1).map((n) => n.path)),
  );

  const toggle = (path: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(path) ? next.delete(path) : next.add(path);
      return next;
    });

  /**
   * The row actions appear on hover and on keyboard focus.
   *
   * They are their own buttons rather than a context menu: a right-click menu
   * is invisible until you know it is there, and these are the operations a
   * person coming from any other editor will look for first.
   */
  const actions = (path: string, isDir: boolean) => (
    <span className="ft-acts">
      {isDir && (
        <button className="ft-act" title={fill(t('New file in {path}'), { path })}
                aria-label={fill(t('New file in {path}'), { path })}
                onClick={(e) => { e.stopPropagation(); onNewIn(path); }}>
          <Icon name="plus" size={11} />
        </button>
      )}
      {/* A pencil, not the caret. This button and the expand caret sit in the
          same row, and until `Icon.tsx` had a pencil they were the same glyph
          pointing two different ways. */}
      <button className="ft-act" title={fill(t('Rename {path}'), { path })}
              aria-label={fill(t('Rename {path}'), { path })}
              onClick={(e) => { e.stopPropagation(); onRename(path); }}>
        <Icon name="pencil" size={11} />
      </button>
      <button className="ft-act danger" title={fill(t('Delete {path}'), { path })}
              aria-label={fill(t('Delete {path}'), { path })}
              onClick={(e) => { e.stopPropagation(); onDelete(path, isDir); }}>
        <Icon name="close" size={11} />
      </button>
    </span>
  );

  const render = (nodes: Node[], depth: number): JSX.Element[] =>
    nodes.flatMap((n) => {
      // `paddingInlineStart`, not `paddingLeft`: this is the one indent in the
      // app that is computed rather than written in the stylesheet, so
      // `test/rtl.test.mjs` — which scans `styles.css` — cannot see it, and a
      // physical one would leave the whole file tree indented from the wrong
      // edge in the three right-to-left languages. On the space scale for the
      // same reason everything else is: 6px is --sp-3, 12px is --sp-6.
      const pad = { paddingInlineStart: `calc(var(--sp-3) + ${depth} * var(--sp-6))` };
      /**
       * Dragging a row out of the explorer.
       *
       * Two types on purpose. `text/plain` is what makes the drag mean
       * something everywhere else — a message box, an editor — and the
       * specific one is how the terminal can tell a path it should quote from
       * a sentence somebody dragged out of a document.
       *
       * The path is as the tree knows it, relative to the open folder;
       * resolving it is the business of whatever catches it, because only the
       * catcher knows what it is relative *to*.
       */
      const menu = onMenu
        ? {
            onContextMenu: (e: React.MouseEvent) => {
              e.preventDefault();
              onMenu(n.path, n.isDir, { x: e.clientX, y: e.clientY });
            },
          }
        : {};
      const dragging = {
        draggable: true,
        onDragStart: (e: React.DragEvent) => {
          e.dataTransfer.setData(DRAG_PATH, n.path);
          e.dataTransfer.setData('text/plain', n.path);
          e.dataTransfer.effectAllowed = 'copy';
          // Said twice on purpose: on macOS this drag travels over the system
          // pasteboard, Tauri takes the drop before the webview sees it, and
          // `dataTransfer` never reaches the other end. See `carry`.
          carry('path', n.path);
        },
        /*
         * Deliberately nothing on `dragend`.
         *
         * Clearing there is the obvious thing and it is a race: when Tauri
         * takes the drop, the order of its event against `dragend` is not
         * ours to decide, and clearing first would empty the register the
         * drop is about to read. Leaving it costs one stale string, which the
         * next drag overwrites and which nothing else ever reads — only a
         * drop carrying no OS paths consults it, and that is an in-app drag,
         * which has just set it.
         */
      };
      if (n.isDir) {
        const open = expanded.has(n.path);
        return [
          <div key={n.path} className="ft-row ft-dir" style={pad} {...dragging} {...menu}>
            <button className="ft-hit" onClick={() => toggle(n.path)} title={n.path}>
              <span className={`ft-caret ${open ? 'open' : ''}`}><Icon name="chevron" size={12} /></span>
              <span className="ft-name">{n.name}</span>
            </button>
            {actions(n.path, true)}
          </div>,
          ...(open ? render(n.children, depth + 1) : []),
        ];
      }
      return [
        <div key={n.path}
             className={`ft-row ${n.path === openPath ? 'on' : ''} ${changed.has(n.path) ? 'changed' : ''}`}
             style={pad} {...dragging} {...menu}>
          <button className="ft-hit" onClick={() => onOpen(n.path)} title={n.path}>
            <span className="ft-icon">{iconFor(n.name)}</span>
            <span className="ft-name">{n.name}</span>
            {changed.has(n.path) && <span className="ft-dot" aria-label={t('has staged changes')} />}
          </button>
          {actions(n.path, false)}
        </div>,
      ];
    });

  if (!entries.length) return <p className="ft-empty">{t('No files indexed yet.')}</p>;
  return <div className="ft">{render(tree, 0)}</div>;
}
