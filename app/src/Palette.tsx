import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { positions, rank } from './fuzzy';
import { diskState, everywhere, parse, type Result, type Sources, type TextHit } from './everywhere';
import type { CategoryId, SettingId } from './settings';
import { Icon } from './Icon';
import type { Entry } from './FileTree';

/**
 * The two overlays: ⌘P to open a file by name, ⌘⇧F to search the project.
 *
 * `search` already existed as a tool the *agent* could call; it was never
 * reachable by the person using the app, who had to ask the agent to grep for
 * them. These are the same two capabilities, given to the human directly.
 */

export function Shell({ onClose, label, children }: {
  onClose: () => void; label: string; children: React.ReactNode;
}) {
  // Send focus back where it came from. Closing an overlay and dropping the
  // caret at the top of the document is the difference between a keyboard user
  // continuing and starting again.
  const came = useRef<Element | null>(null);
  useEffect(() => {
    came.current = document.activeElement;
    return () => { (came.current as HTMLElement | null)?.focus?.(); };
  }, []);

  // Escape works wherever focus is inside the overlay, not only in the input.
  // Arrowing into the results used to leave no way out but the mouse.
  const escape = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  return (
    <div className="pal-back" onMouseDown={onClose}>
      <div className="pal" onMouseDown={(e) => e.stopPropagation()} onKeyDown={escape}
           role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>
  );
}

/** Query characters shown in the accent colour, so the ranking is legible. */
export function Marked({ text, query }: { text: string; query: string }) {
  const hits = useMemo(() => new Set(positions(query, text)), [text, query]);
  if (!hits.size) return <>{text}</>;
  return (
    <>
      {[...text].map((c, i) => (hits.has(i) ? <b key={i}>{c}</b> : <span key={i}>{c}</span>))}
    </>
  );
}

/** Keeps the highlighted row inside the scroll box as the selection moves. */
export function useScrollIntoView(active: number) {
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
    <Shell onClose={onClose} label={t('Go to file…')}>
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
              <span className="pal-dir" title={path}>{cut > 0 ? path.slice(0, cut) : ''}</span>
            </button>
          );
        })}
      </div>
    </Shell>
  );
}

export interface Symbol {
  name: string;
  kind: string;
  path: string;
  line: number;
}

interface SymbolProps {
  /** Symbols to choose from. Already fetched, so the overlay opens instantly. */
  symbols: Symbol[];
  /** Set when the list is one file's, which changes what is worth showing. */
  scope: string | null;
  onOpen: (path: string, line: number) => void;
  onClose: () => void;
  t: (s: string) => string;
}

/**
 * ⌘T across the project, ⌘⇧O within the open file.
 *
 * One component for both, because they differ only in where the list came from
 * and whether the path is worth repeating on every row. Ranked with the same
 * matcher as ⌘P — two palettes that ranked differently would feel like two
 * different applications.
 */
export function Symbols({ symbols, scope, onOpen, onClose, t }: SymbolProps) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const list = useScrollIntoView(active);

  const shown = useMemo(() => {
    if (!q.trim()) {
      // No query: within a file, declaration order is the file's own structure
      // and is more use than any ranking. Across a project it is arbitrary, so
      // the first fifty are just the first fifty.
      return symbols.slice(0, 200);
    }
    return rank(q, symbols, (s) => s.name, 200);
  }, [q, symbols]);

  useEffect(() => { setActive(0); }, [q]);

  function key(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(shown.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const s = shown[active];
      if (s) { onOpen(s.path, s.line); onClose(); }
    }
  }

  const label = scope ? t('Go to symbol in file…') : t('Go to symbol in project…');
  return (
    <Shell onClose={onClose} label={label}>
      <input className="pal-in" autoFocus value={q} placeholder={label}
             onChange={(e) => setQ(e.target.value)} onKeyDown={key} spellCheck={false} />
      <div className="pal-list" ref={list}>
        {shown.length === 0 && (
          <p className="pal-none">
            {symbols.length ? t('No matching symbol.') : t('No symbols found here.')}
          </p>
        )}
        {shown.map((s, i) => (
          <button key={`${s.path}:${s.line}:${s.name}`} className={`pal-row ${i === active ? 'on' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => { onOpen(s.path, s.line); onClose(); }}>
            <span className="pal-kind">{s.kind}</span>
            <span className="pal-name"><Marked text={s.name} query={q} /></span>
            <span className="pal-dir" title={`${s.path}:${s.line}`}>{scope ? `:${s.line}` : `${s.path}:${s.line}`}</span>
          </button>
        ))}
      </div>
    </Shell>
  );
}

interface Hit { path: string; line: number; text: string }

interface FindProps {
  root: string;
  onOpen: (path: string, line: number) => void;
  onClose: () => void;
  /**
   * Stage the replacement across every matching file. Staged, not written: a
   * bulk edit is precisely the one nobody reads afterwards, so it goes through
   * the same review as anything the agent proposes.
   */
  onReplace: (find: string, to: string, opts: { fold: boolean; words: boolean }) => Promise<number>;
  /** The term to open on, when a recent search in the rail asked for one. */
  initial?: string;
  /**
   * The query this panel ended on, if it matched anything. One call per opening
   * of the panel, on the way out: the search runs per debounced keystroke, so
   * reporting each one would fill the rail with every prefix of every word
   * anybody typed. A query that found nothing is not reported at all — that is
   * a mistake, not something worth offering back.
   */
  onSearched?: (q: string) => void;
  t: (s: string) => string;
}

export function FindInFiles({ root, onOpen, onClose, onReplace, initial, onSearched, t }: FindProps) {
  const [replacement, setReplacement] = useState('');
  const [showReplace, setShowReplace] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [q, setQ] = useState(initial ?? '');
  const [fold, setFold] = useState(true);
  const [words, setWords] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const list = useScrollIntoView(active);
  // The last query that found something, handed up when the panel closes.
  const matched = useRef('');
  useEffect(() => () => { if (matched.current) onSearched?.(matched.current); }, []);

  // Debounced, because each search walks the tree: firing per keystroke would
  // queue a full walk behind every character of a word.
  useEffect(() => {
    if (!q.trim() || !root) { setHits([]); setErr(null); return; }
    let cancelled = false;
    const h = window.setTimeout(() => {
      setBusy(true);
      invoke<{ hits: Hit[] }>('search', {
        root, query: q, maxHits: 300, caseInsensitive: fold, wholeWord: words,
      })
        .then((r) => {
          if (cancelled) return;
          setHits(r.hits); setErr(null); setActive(0);
          if (r.hits.length > 0) matched.current = q;
        })
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
    <Shell onClose={onClose} label={t('Search the project…')}>
      <div className="pal-head">
        <input className="pal-in" autoFocus value={q} placeholder={t('Search the project…')}
               onChange={(e) => setQ(e.target.value)} onKeyDown={key} spellCheck={false} />
        {/* `aria-label` as well as `title`, and `aria-pressed` because all three
            are modes rather than actions: the accessible name of the Replace
            toggle was the character `⇄`, and nothing at all announced whether
            any of them was on. */}
        <button className={`pal-tog ${fold ? '' : 'on'}`} onClick={() => setFold((v) => !v)}
                title={t('Match case')} aria-label={t('Match case')} aria-pressed={!fold}>Aa</button>
        <button className={`pal-tog ${words ? 'on' : ''}`} onClick={() => setWords((v) => !v)}
                title={t('Whole word')} aria-label={t('Whole word')} aria-pressed={words}>
          <span className="pal-ab">ab</span></button>
        <button className={`pal-tog ${showReplace ? 'on' : ''}`} aria-pressed={showReplace}
                onClick={() => setShowReplace((v) => !v)}
                title={t('Replace')} aria-label={t('Replace')}><Icon name="swap" size={13} /></button>
      </div>

      {showReplace && (
        <div className="pal-head pal-replace">
          <input className="pal-in" value={replacement} placeholder={t('Replace with…')}
                 onChange={(e) => setReplacement(e.target.value)}
                 onKeyDown={(e) => { if (e.key === 'Escape') onClose(); }}
                 spellCheck={false} />
          <button className="approve" disabled={!q.trim() || replacing || !hits.length}
                  onClick={async () => {
                    setReplacing(true);
                    try { await onReplace(q, replacement, { fold, words }); onClose(); }
                    finally { setReplacing(false); }
                  }}>
            {replacing ? t('Staging…') : `${t('Replace in')} ${files} ${files === 1 ? t('file') : t('files')}`}
          </button>
        </div>
      )}
      <div className="pal-list" ref={list}>
        {err && <p className="pal-none pal-err">{err}</p>}
        {!err && q.trim() && !busy && hits.length === 0 && <p className="pal-none">{t('No matches.')}</p>}
        {hits.map((h, i) => (
          <button key={`${h.path}:${h.line}:${i}`} className={`pal-row hit ${i === active ? 'on' : ''}`}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => { onOpen(h.path, h.line); onClose(); }}>
            <span className="pal-where">{h.path.split(/[/\\]/).pop()}<i>:{h.line}</i></span>
            <span className="pal-line" title={h.text.trim()}>{h.text.trim()}</span>
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

/**
 * One field that searches everything — the palette behind the header box.
 *
 * The other three overlays in this file each answer one question. This one
 * answers all of them at once: `everywhere.ts` takes the sources the app
 * already holds and returns them grouped by kind and ordered between the
 * groups, and this draws that. Nothing here decides what matches or what comes
 * first; every one of those decisions is in the module, where it can be tested.
 *
 * ## The one thing this component does decide: when the disk is read
 *
 * `#` is the only query that walks the project, and a header field that walks
 * it per keystroke is a header field nobody can type in. So the module says
 * `needsDisk` and this waits for **Enter** — not a debounce, because a pause is
 * something a person does constantly while thinking, and a grep per thought is
 * the same bill arriving more slowly. Enter runs it; the second Enter, once
 * there are hits, opens the row like everywhere else.
 */
interface EverythingProps {
  /** The sources already in memory. `t` and `hits` are supplied here. */
  sources: Omit<Sources, 't' | 'hits'>;
  /** The open folder, for the one search that reads the disk. */
  root: string;
  onOpen: (path: string, line?: number) => void;
  onChat: (id: string) => void;
  onTerminal: (id: string) => void;
  onSetting: (id: SettingId, category: CategoryId) => void;
  onCommand: (id: string) => void;
  onClose: () => void;
  t: (s: string) => string;
}

export function Everything({
  sources, root, onOpen, onChat, onTerminal, onSetting, onCommand, onClose, t,
}: EverythingProps) {
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // The hits carry the term they were found for. A `#` query that has moved on
  // by one character has no hits, and showing the old ones would be answering a
  // question nobody asked any more.
  const [found, setFound] = useState<{ term: string; hits: TextHit[] } | null>(null);
  const list = useScrollIntoView(active);

  // The query, one step ahead of the results: `diskState` has to be answerable
  // before anything is spent, which is why `parse` is exported on its own.
  const asked = useMemo(() => parse(q), [q]);
  const disk = diskState(asked, found, busy);
  // Hits belong to the term they were fetched for. Held apart from the memo so
  // the identity is stable while `found` is, and so there is one comparison
  // rather than two that could drift.
  const hits = found && found.term === asked.term ? found.hits : undefined;

  // Pure, over arrays already in memory, so recomputing it is cheaper than
  // deciding not to. `t` is in the deps and that is safe here for the reason
  // the lesson about `t` is careful to name: it is an effect that re-fetches
  // that hurts, not a memo that recomputes.
  const res = useMemo(() => everywhere(q, { ...sources, hits, t }), [q, sources, hits, t]);

  const rows = useMemo(() => res.groups.flatMap((g) => g.results), [res]);
  // A new query, so the previous one's failure is not this one's news.
  useEffect(() => { setActive(0); setErr(null); }, [q]);

  function grep() {
    if (!res.needsDisk || busy) return;
    const term = res.term;
    // Nothing to walk. Recorded as an answer rather than left in `ask`, or
    // Enter would be a key that visibly does nothing for as long as the field
    // is open.
    if (!root) { setFound({ term, hits: [] }); return; }
    setBusy(true);
    invoke<{ hits: TextHit[] }>('search', {
      root, query: term, maxHits: 300, caseInsensitive: true, wholeWord: false,
    })
      .then((r) => { setFound({ term, hits: r.hits }); setErr(null); })
      .catch((e) => { setFound({ term, hits: [] }); setErr(String(e)); })
      .finally(() => setBusy(false));
  }

  function open(r: Result) {
    switch (r.target.go) {
      case 'file': onOpen(r.target.path, r.target.line); break;
      case 'chat': onChat(r.target.id); break;
      case 'terminal': onTerminal(r.target.id); break;
      case 'setting': onSetting(r.target.id, r.target.category); break;
      case 'command': onCommand(r.target.id); break;
    }
    onClose();
  }

  function key(e: React.KeyboardEvent) {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(rows.length - 1, i + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      // The one keystroke that spends anything — and only while the hits in
      // hand are not already this query's, so a `#` search can be narrowed and
      // run again rather than answering the first term for ever.
      if (disk === 'searching') return;
      if (disk === 'ask') { grep(); return; }
      if (rows[active]) open(rows[active]);
    }
  }

  // The row's index in the flat list, so ↑/↓ crosses the group headings.
  let n = -1;
  return (
    <Shell onClose={onClose} label={t('Search everything…')}>
      <input className="pal-in" autoFocus value={q} placeholder={t('Search everything…')}
             onChange={(e) => setQ(e.target.value)} onKeyDown={key} spellCheck={false} />
      <div className="pal-list" ref={list}>
        {err && <p className="pal-none pal-err">{err}</p>}
        {busy && <p className="pal-none">{t('Searching…')}</p>}
        {disk === 'ask' && (
          <p className="pal-none">{t('Press Enter to search the project')}</p>
        )}
        {/* `answered` as well as `free`: a `#` search that ran and found
            nothing has to say so, or the palette goes blank on the one query
            somebody deliberately paid for. */}
        {!busy && !err && disk !== 'ask' && res.total === 0 && (
          <p className="pal-none">{t('No matches.')}</p>
        )}
        {res.groups.map((g) => (
          <div key={g.kind} className="pal-group">
            <h3 className="pal-group-name">{t(g.label)}</h3>
            {g.results.map((r) => {
              n += 1;
              const i = n;
              return (
                <button key={r.key} className={`pal-row ${i === active ? 'on' : ''}`}
                        onMouseEnter={() => setActive(i)} onClick={() => open(r)}>
                  {r.tag && <span className="pal-kind">{r.tag}</span>}
                  <span className={`pal-name ${r.mono ? 'pal-ran' : ''}`}>
                    <Marked text={r.title} query={res.term} />
                  </span>
                  {r.detail && <span className="pal-dir" title={r.detail}>{r.detail}</span>}
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </Shell>
  );
}
