import { useState, type ReactNode } from 'react';

/**
 * Collapsible sidebar section.
 *
 * Open state persists per section: which panels someone keeps open is a working
 * preference, and having them all spring back on every launch is the kind of
 * small friction that makes an app feel like it is not paying attention.
 */
export function Section({
  id, title, count, children, defaultOpen = true, action,
}: {
  id: string;
  title: string;
  count?: number | string;
  children: ReactNode;
  defaultOpen?: boolean;
  action?: ReactNode;
}) {
  const key = `vylo.section.${id}`;
  const [open, setOpen] = useState(() => {
    const v = localStorage.getItem(key);
    return v === null ? defaultOpen : v === '1';
  });

  const set = (v: boolean) => {
    setOpen(v);
    try { localStorage.setItem(key, v ? '1' : '0'); } catch { /* private mode */ }
  };

  return (
    <section className={`sb-sec ${open ? 'open' : ''}`}>
      <div className="sb-head">
        <button className="sb-toggle" onClick={() => set(!open)} aria-expanded={open}>
          <span className={`sb-caret ${open ? 'open' : ''}`}>▸</span>
          <span className="sb-title">{title}</span>
          {count !== undefined && count !== 0 && <span className="sb-count">{count}</span>}
        </button>
        {action}
      </div>
      {open && <div className="sb-body">{children}</div>}
    </section>
  );
}
