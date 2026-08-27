import { useMemo, useState } from 'react';

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
  toml: 'T', sql: 'DB', png: '▣', jpg: '▣', jpeg: '▣', svg: '▣', gif: '▣',
};
const iconFor = (name: string) => ICONS[name.split('.').pop()?.toLowerCase() || ''] || '·';

interface Props {
  entries: Entry[];
  openPath: string | null;
  onOpen: (path: string) => void;
  /** Paths with staged edits, marked so pending work is visible in context. */
  changed: Set<string>;
}

export function FileTree({ entries, openPath, onOpen, changed }: Props) {
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

  const render = (nodes: Node[], depth: number): JSX.Element[] =>
    nodes.flatMap((n) => {
      const pad = { paddingLeft: `${6 + depth * 12}px` };
      if (n.isDir) {
        const open = expanded.has(n.path);
        return [
          <button key={n.path} className="ft-row ft-dir" style={pad}
                  onClick={() => toggle(n.path)} title={n.path}>
            <span className={`ft-caret ${open ? 'open' : ''}`}>▸</span>
            <span className="ft-name">{n.name}</span>
          </button>,
          ...(open ? render(n.children, depth + 1) : []),
        ];
      }
      return [
        <button key={n.path}
                className={`ft-row ft-file ${n.path === openPath ? 'on' : ''} ${changed.has(n.path) ? 'changed' : ''}`}
                style={pad} onClick={() => onOpen(n.path)} title={n.path}>
          <span className="ft-icon">{iconFor(n.name)}</span>
          <span className="ft-name">{n.name}</span>
          {changed.has(n.path) && <span className="ft-dot" aria-label="has staged changes" />}
        </button>,
      ];
    });

  if (!entries.length) return <p className="ft-empty">No files indexed yet.</p>;
  return <div className="ft">{render(tree, 0)}</div>;
}
