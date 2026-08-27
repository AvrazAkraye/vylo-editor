import { useMemo, useState } from 'react';
import { countChanges, diffLines, type Change } from './pending';

interface Props {
  changes: Change[];
  onApprove: (paths: string[]) => void;
  onReject: (paths: string[]) => void;
  busy: boolean;
}

/**
 * The approval gate.
 *
 * Nothing the agent proposes reaches the disk without passing through here, so
 * the diff has to be readable enough that people actually look at it. An
 * approval flow that is tedious gets click-throughed, and a click-throughed
 * gate is the same as no gate.
 */
export function Review({ changes, onApprove, onReject, busy }: Props) {
  const [openPath, setOpenPath] = useState<string | null>(changes[0]?.path ?? null);

  const diffs = useMemo(() => {
    const m = new Map<string, ReturnType<typeof diffLines>>();
    for (const c of changes) m.set(c.path, diffLines(c.before, c.after));
    return m;
  }, [changes]);

  if (!changes.length) return null;

  const total = changes.reduce(
    (acc, c) => {
      const n = countChanges(diffs.get(c.path) || []);
      return { added: acc.added + n.added, removed: acc.removed + n.removed };
    },
    { added: 0, removed: 0 },
  );

  const open = changes.find((c) => c.path === openPath) ?? changes[0];
  const rows = diffs.get(open.path) || [];

  return (
    <section className="review" aria-label="Proposed changes">
      <header className="rv-head">
        <div className="rv-title">
          <b>{changes.length} file{changes.length > 1 ? 's' : ''} proposed</b>
          <span className="stat">
            <span className="add">+{total.added}</span>
            <span className="del">−{total.removed}</span>
          </span>
          <span className="note">Nothing is written until you approve.</span>
        </div>
        <div className="rv-actions">
          <button className="reject" disabled={busy}
                  onClick={() => onReject(changes.map((c) => c.path))}>
            Discard all
          </button>
          <button className="approve" disabled={busy}
                  onClick={() => onApprove(changes.map((c) => c.path))}>
            Approve all
          </button>
        </div>
      </header>

      <div className="rv-body">
        <ul className="rv-files">
          {changes.map((c) => {
            const n = countChanges(diffs.get(c.path) || []);
            return (
              <li key={c.path}>
                <button className={c.path === open.path ? 'on' : ''} onClick={() => setOpenPath(c.path)}>
                  <span className="fp">{c.path}</span>
                  {c.isNew && <span className="new">new</span>}
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
            <div className="rv-one">
              <button className="reject" disabled={busy} onClick={() => onReject([open.path])}>Discard</button>
              <button className="approve" disabled={busy} onClick={() => onApprove([open.path])}>Approve</button>
            </div>
          </div>
          <pre>
            {rows.map((r, i) => (
              <div key={i} className={`row ${r.kind === '+' ? 'add' : r.kind === '-' ? 'del' : ''}`}>
                <span className="ln">{r.a ?? ''}</span>
                <span className="ln">{r.b ?? ''}</span>
                <span className="mk">{r.kind === ' ' ? ' ' : r.kind}</span>
                <span className="tx">{r.text || ' '}</span>
              </div>
            ))}
          </pre>
        </div>
      </div>
    </section>
  );
}
