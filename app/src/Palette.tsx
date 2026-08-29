import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { positions, rank } from './fuzzy';
import type { Entry } from './FileTree';

/**
 * The two overlays: ⌘P to open a file by name, ⌘⇧F to search the project.
 *
 * `search` already existed as a tool the *agent* could call; it was never
 * reachable by the person using the app, who had to ask the agent to grep for
 * them. These are the same two capabilities, given to the human directly.
 */

function Shell({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="pal-back" onMouseDown={onClose}>
      <div className="pal" onMouseDown={(e) => e.stopPropagation()} role="dialog">
        {children}
      </div>
    </div>
  );
}

/** Query characters shown in the accent colour, so the ranking is legible. */
function Marked({ text, query }: { text: string; query: string }) {
  const hits = useMemo(() => new Set(positions(query, text)), [text, query]);
  if (!hits.size) return <>{text}</>;
  return (
    <>
      {[...text].map((c, i) => (hits.has(i) ? <b key={i}>{c}</b> : <span key={i}>{c}</span>))}
    </>
  );
}

/** Keeps the highlighted row inside the scroll box as the selection moves. */
function useScrollIntoView(active: number) {
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector('.pal-row.on')?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  return list;
}

interface QuickOpenProps {
  entries: Entry[];
  onOpen: (path: string) => void;
  onClose: () => void;
  t: (s: string) => string;
}

export function QuickOpen({ entries, onOpen, onClose, t }: QuickOpenProps) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const files = useMemo(() => entries.filter((e) => !e.is_dir).map((e) => e.path), [entries]);
  // No query means the list is still useful: it is the project, unranked.
  const shown = useMemo(() => (q.trim() ? rank(q, files, (f) => f, 50) : files.slice(0, 50)), [q, files]);
  const list = useScrollIntoView(active);

  useEffect(() => { setActive(0); }, [q]);

  function key(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(shown.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[active]) { onOpen(shown[active]); onClose(); } }
  }

  return (
    <Shell onClose={onClose}>
      <input className="pal-in" autoFocus value={q} placeholder={t('Go to file…')}
             onChange={(e) => setQ(e.target.value)} onKeyDown={key} spellCheck={false} />
      <div className="pal-list" ref={list}>
        {shown.length === 0 && <p className="pal-none">{t('No matching file.')}</p>}
        {shown.map((path, i) => {
          const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
          return (
            <button key={path} className={`pal-row ${i === active ? 'on' : ''}`}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => { onOpen(path); onClose(); }}>
              <span className="pal-name"><Marked text={path.slice(cut + 1)} query={q} /></span>
              <span className="pal-dir">{cut > 0 ? path.slice(0, cut) : ''}</span>
            </button>
          );
        })}
      </div>
    </Shell>
  );
}

interface Hit { path: string; line: number; text: string }

interface FindProps {
  root: string;
  onOpen: (path: string, line: number) => void;
  onClose: () => void;
  t: (s: string) => string;
}

export function FindInFiles({ root, onOpen, onClose, t }: FindProps) {
  const [q, setQ] = useState('');
  const [fold, setFold] = useState(true);
  const [words, setWords] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const list = useScrollIntoView(active);

  // Debounced, because each search walks the tree: firing per keystroke would
  // queue a full walk behind every character of a word.
  useEffect(() => {
    if (!q.trim() || !root) { setHits([]); setErr(null); return; }
    let cancelled = false;
    const h = window.setTimeout(() => {
      setBusy(true);
      invoke<Hit[]>('search', {
        root, query: q, maxHits: 300, caseInsensitive: fold, wholeWord: words,
      })
        .then((r) => { if (!cancelled) { setHits(r); setErr(null); setActive(0); } })
        .catch((e) => { if (!cancelled) { setHits([]); setErr(String(e)); } })
        .finally(() => { if (!cancelled) setBusy(false); });
    }, 180);
    return () => { cancelled = true; window.clearTimeout(h); };
  }, [q, root, fold, words]);

  function key(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(hits.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const h = hits[active];
      if (h) { onOpen(h.path, h.line); onClose(); }
    }
  }

  const files = new Set(hits.map((h) => h.path)).size;

  return (
    <Shell onClose={onClose}>
      <div className="pal-head">
        <input className="pal-in" autoFocus value={q} placeholder={t('Search the project…')}
               onChange={(e) => setQ(e.target.value)} onKeyDown={key} spellCheck={false} />
        <button className={`pal-tog ${fold ? '' : 'on'}`} onClick={() => setFold((v) => !v)}
                title={t('Match case')}>Aa</button>
        <button className={`pal-tog ${words ? 'on' : ''}`} onClick={() => setWords((v) => !v)}
                title={t('Whole word')}>|ab|</button>
      </div>
      <div className="pal-list" ref={list}>
        {err && <p className="pal-none pal-err">{err}</p>}
        {!err && q.trim() && !busy && hits.length === 0 && <p className="pal-none">{t('No matches.')}</p>}
        {hits.map((h, i) => (
          <button key={`${h.path}:${h.line}:${i}`} className={`pal-row hit ${i === active ? 'on' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => { onOpen(h.path, h.line); onClose(); }}>
            <span className="pal-where">{h.path.split(/[/\\]/).pop()}<i>:{h.line}</i></span>
            <span className="pal-line">{h.text.trim()}</span>
          </button>
        ))}
      </div>
      {q.trim() && (
        <div className="pal-foot">
          {busy ? t('Searching…')
                : `${hits.length}${hits.length >= 300 ? '+' : ''} ${t('in')} ${files} ${t('files')}`}
        </div>
      )}
    </Shell>
  );
}
