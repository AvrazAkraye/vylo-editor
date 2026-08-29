import { useEffect, useMemo, useRef, useState } from 'react';
import { buildPartial, diffRows, hunks, type Change, type Hunk, type Row } from './pending';
import { Icon } from './Icon';

interface Props {
  changes: Change[];
  onApprove: (paths: string[]) => void;
  /** Write only the ticked hunks of one file; the rest stay staged. */
  onApproveHunks: (path: string, content: string) => void;
  onReject: (paths: string[]) => void;
  busy: boolean;
  t: (s: string) => string;
}

/**
 * The approval gate.
 *
 * Nothing the agent proposes reaches the disk without passing through here, so
 * the diff has to be readable enough that people actually look at it. An
 * approval flow that is tedious gets click-throughed, and a click-throughed
 * gate is the same as no gate.
 *
 * The whole file used to be one decision, which made the gate coarser than the
 * thing it guards: a change is rarely uniformly good, and "approve all of this
 * or none of it" pushes people toward approving all of it. Each run of edits is
 * now its own decision, and the header says exactly how many lines will be
 * written before you commit to anything.
 */

/** Lines shown either side of a change. Matches the hunk merge threshold. */
const CONTEXT = 3;

export function Review({ changes, onApprove, onApproveHunks, onReject, busy, t }: Props) {
  const [openPath, setOpenPath] = useState<string | null>(changes[0]?.path ?? null);
  /** Hunks the user has un-ticked, per file. Absent means "all ticked". */
  const [off, setOff] = useState<Map<string, Set<number>>>(new Map());
  const [focused, setFocused] = useState(0);
  const box = useRef<HTMLElement>(null);

  const diffs = useMemo(() => {
    const m = new Map<string, { rows: Row[]; list: Hunk[] }>();
    for (const c of changes) {
      const rows = diffRows(c.before, c.after);
      m.set(c.path, { rows, list: hunks(rows) });
    }
    return m;
  }, [changes]);

  // A file that has just been written is gone from `changes`, so the selection
  // has to move rather than pointing at nothing.
  const open = changes.find((c) => c.path === openPath) ?? changes[0];
  useEffect(() => { setFocused(0); }, [open?.path]);

  if (!changes.length) return null;

  const { rows, list } = diffs.get(open.path) ?? { rows: [], list: [] };
  const skipped = off.get(open.path) ?? new Set<number>();
  const accepted = new Set(list.filter((h) => !skipped.has(h.index)).map((h) => h.index));

  const picked = list
    .filter((h) => accepted.has(h.index))
    .reduce((s, h) => ({ added: s.added + h.added, removed: s.removed + h.removed }), { added: 0, removed: 0 });
  const total = changes.reduce((acc, c) => {
    const d = diffs.get(c.path);
    const n = (d?.list ?? []).reduce((s, h) => ({ added: s.added + h.added, removed: s.removed + h.removed }), { added: 0, removed: 0 });
    return { added: acc.added + n.added, removed: acc.removed + n.removed };
  }, { added: 0, removed: 0 });

  const partial = accepted.size > 0 && accepted.size < list.length;

  function toggle(index: number) {
    setOff((prev) => {
      const next = new Map(prev);
      const set = new Set(next.get(open.path) ?? []);
      if (set.has(index)) set.delete(index); else set.add(index);
      next.set(open.path, set);
      return next;
    });
  }

  function writeFile() {
    if (!accepted.size) return;
    if (accepted.size === list.length) onApprove([open.path]);
    else onApproveHunks(open.path, buildPartial(rows, list, accepted));
    setOff((prev) => { const n = new Map(prev); n.delete(open.path); return n; });
  }

  /**
   * j/k/space/enter, but only while the pane has focus. Binding them globally
   * would make them unusable in the composer, which is where people spend most
   * of their time.
   */
  function onKey(e: React.KeyboardEvent) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 'j' || e.key === 'ArrowDown') { e.preventDefault(); setFocused((i) => Math.min(list.length - 1, i + 1)); }
    else if (k === 'k' || e.key === 'ArrowUp') { e.preventDefault(); setFocused((i) => Math.max(0, i - 1)); }
    else if (e.key === ' ') { e.preventDefault(); if (list[focused]) toggle(list[focused].index); }
    else if (e.key === 'Enter') { e.preventDefault(); writeFile(); }
  }

  return (
    <section className="review" aria-label={t('Proposed changes')} tabIndex={-1} ref={box} onKeyDown={onKey}>
      <header className="rv-head">
        <div className="rv-title">
          <b>{changes.length === 1
            ? t('1 file proposed')
            : `${changes.length} ${t('files proposed')}`}</b>
          <span className="stat">
            <span className="add">+{total.added}</span>
            <span className="del">−{total.removed}</span>
          </span>
          <span className="note">{t('Nothing is written until you approve.')}</span>
        </div>
        <div className="rv-actions">
          <button className="reject" disabled={busy}
                  onClick={() => onReject(changes.map((c) => c.path))}>
            {t('Discard all')}
          </button>
          <button className="approve" disabled={busy}
                  onClick={() => onApprove(changes.map((c) => c.path))}>
            {t('Approve all')}
          </button>
        </div>
      </header>

      <div className="rv-body">
        <ul className="rv-files">
          {changes.map((c) => {
            const d = diffs.get(c.path);
            const n = (d?.list ?? []).reduce((s, h) => ({ added: s.added + h.added, removed: s.removed + h.removed }), { added: 0, removed: 0 });
            return (
              <li key={c.path}>
                <button className={c.path === open.path ? 'on' : ''} onClick={() => setOpenPath(c.path)}>
                  <span className="fp">{c.path}</span>
                  {c.isNew && <span className="new">{t('new')}</span>}
                  <span className="mini">
                    <span className="add">+{n.added}</span><span className="del">−{n.removed}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>

        <div className="rv-diff">
          <div className="rv-diff-bar">
            <code>{open.path}</code>
            <span className="rv-keys">
              <kbd>j</kbd><kbd>k</kbd> {t('move')} · <kbd>space</kbd> {t('toggle')} · <kbd>↵</kbd> {t('write')}
            </span>
            <div className="rv-one">
              <button className="reject" disabled={busy} onClick={() => onReject([open.path])}>{t('Discard')}</button>
              <button className="approve" disabled={busy || !accepted.size} onClick={writeFile}>
                {partial
                  ? `${t('Write')} ${accepted.size}/${list.length} · +${picked.added} −${picked.removed}`
                  : t('Approve')}
              </button>
            </div>
          </div>

          <div className="rv-hunks">
            {list.length === 0 && <p className="ft-empty">{t('No changes left in this file.')}</p>}
            {list.map((h, n) => {
              const on = accepted.has(h.index);
              // Context either side, clipped to the file and never overlapping
              // the next hunk, which the merge threshold already guarantees.
              const from = Math.max(0, h.from - CONTEXT);
              const to = Math.min(rows.length - 1, h.to + CONTEXT);
              return (
                <div key={h.index} className={`hunk ${on ? '' : 'skipped'} ${n === focused ? 'focus' : ''}`}>
                  <button className="hunk-bar" onClick={() => { setFocused(n); toggle(h.index); }}
                          aria-pressed={on}>
                    <span className={`hunk-tick ${on ? 'on' : ''}`}>
                      {on && <Icon name="check" size={12} />}
                    </span>
                    <span className="hunk-n">{t('Change')} {n + 1}</span>
                    <span className="mini"><span className="add">+{h.added}</span><span className="del">−{h.removed}</span></span>
                    {!on && <span className="hunk-skip">{t('not included')}</span>}
                  </button>
                  <pre>
                    {rows.slice(from, to + 1).map((r, i) => (
                      <div key={i} className={`row ${r.kind === '+' ? 'add' : r.kind === '-' ? 'del' : ''}`}>
                        <span className="ln">{r.a ?? ''}</span>
                        <span className="ln">{r.b ?? ''}</span>
                        <span className="mk">{r.kind === ' ' ? ' ' : r.kind}</span>
                        <span className="tx">{r.text || ' '}</span>
                      </div>
                    ))}
                  </pre>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
