import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Icon } from './Icon';
import { anyMatch, arrange, badgeOf, tally, type Order, type Symbol } from './outline';

/**
 * The shape of the file you have open.
 *
 * Read from the *buffer*, not from the index, and re-read whenever the caret
 * moves or the text changes. An outline built from disk would be missing the
 * function you just typed and would still list the one you just deleted, which
 * is worse than no outline: it is one you would learn not to trust.
 *
 * Debounced, because it runs on every keystroke otherwise, and because the
 * answer while somebody is halfway through typing `func` is not worth having.
 */

/** What the panel needs from the open editor. */
export interface Buffer {
  text: () => string;
  line: () => number;
}

interface Props {
  t: (s: string) => string;
  /** The open file, or null when it is the chat or a pseudo-tab. */
  path: string | null;
  /** The editor holding it, read at call time. Null when nothing is open. */
  buffer: () => Buffer | null;
  onJump: (path: string, line: number) => void;
}

/**
 * How often the buffer is looked at.
 *
 * Polled rather than pushed, and that is a deliberate trade. The alternative is
 * an `onChange` and an `onCaret` on the editor threaded through `App.tsx` to
 * here, which is two more props on a component that has twenty and a re-render
 * of the whole window on every keystroke.
 *
 * The poll is cheap because it is two getter calls: the text is compared to
 * what was last seen, and `symbols_in_text` — the only part that crosses into
 * Rust — runs only when the text has actually changed. A caret move costs a
 * number comparison.
 */
const LOOK = 400;

export function OutlinePanel({ t, path, buffer, onJump }: Props) {
  const [symbols, setSymbols] = useState<Symbol[]>([]);
  const [line, setLine] = useState(0);
  const [query, setQuery] = useState('');
  const [order, setOrder] = useState<Order>('file');
  const seen = useRef('');

  useEffect(() => {
    seen.current = '';
    if (!path) { setSymbols([]); setLine(0); return; }
    let off = false;

    const look = () => {
      const b = buffer();
      if (!b) return;
      setLine(b.line());
      const text = b.text();
      if (text === seen.current) return;
      seen.current = text;
      void invoke<Symbol[]>('symbols_in_text', { path, text })
        .then((list) => { if (!off) setSymbols(list); })
        .catch(() => { if (!off) setSymbols([]); });
    };

    look();
    const id = window.setInterval(look, LOOK);
    return () => { off = true; window.clearInterval(id); };
  }, [path, buffer]);

  if (!path) return <p className="ft-empty">{t('Open a file to see its outline.')}</p>;

  const rows = arrange(symbols, { query, order, cursor: line });
  const counts = tally(symbols);

  return (
    <div className="ol">
      <div className="ol-head">
        <span className="tsl-find">
          <Icon name="search" size={13} />
          <input value={query} onChange={(e) => setQuery(e.target.value)}
                 placeholder={t('Filter…')} aria-label={t('Filter…')} spellCheck={false} />
        </span>
        {/* File order is the default because an outline is a map, and sorting a
            map alphabetically throws away the only thing a map has. */}
        <button className={`ol-sort ${order === 'name' ? 'on' : ''}`}
                aria-pressed={order === 'name'}
                onClick={() => setOrder(order === 'name' ? 'file' : 'name')}
                title={t(order === 'name' ? 'Sorted by name — click for file order' : 'In file order — click to sort by name')}
                aria-label={t(order === 'name' ? 'Sorted by name — click for file order' : 'In file order — click to sort by name')}>
          <Icon name="swap" size={13} />
        </button>
      </div>

      {counts.length > 0 && (
        <p className="ol-tally">
          {counts.map(({ family, n }) => (
            <span key={family}><b>{n}</b> {t(family)}</span>
          ))}
        </p>
      )}

      {rows.length === 0 ? (
        // Two different states, and saying the second when the first is true
        // tells somebody their search failed when they never made one.
        <p className="ft-empty">
          {!symbols.length ? t('Nothing declared in this file.')
            : !anyMatch(symbols, query) ? t('Nothing matches that.')
            : t('Nothing declared in this file.')}
        </p>
      ) : (
        <ul className="ol-list">
          {rows.map((r) => (
            <li key={`${r.line}:${r.name}`}>
              <button className={`ol-row f-${r.family} ${r.here ? 'here' : ''}`}
                      onClick={() => onJump(r.path || path, r.line)}
                      aria-current={r.here ? 'true' : undefined}>
                <i className="ol-kind" title={r.kind} aria-hidden="true">{badgeOf(r.kind)}</i>
                <span className="ol-name">{r.name}</span>
                <span className="ol-line">{r.line}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default OutlinePanel;
