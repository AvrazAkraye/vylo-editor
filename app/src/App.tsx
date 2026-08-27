import { useEffect, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { runAgent, type Msg } from './agent';

type Line = { kind: 'you' | 'text' | 'tool' | 'result' | 'error'; text: string };

const LS = {
  base: 'vylo.baseUrl',
  key: 'vylo.apiKey',
  model: 'vylo.model',
  root: 'vylo.root',
};

export function App() {
  // chat.vylo-tech.com rather than capi: only that Caddy block sets
  // `flush_interval -1`, so it is the one that will not buffer once this starts
  // streaming.
  const [baseUrl, setBaseUrl] = useState(() => localStorage.getItem(LS.base) || 'https://chat.vylo-tech.com');
  const [apiKey, setApiKey] = useState(() => localStorage.getItem(LS.key) || '');
  const [model, setModel] = useState(() => localStorage.getItem(LS.model) || 'claude-haiku-4-5');
  const [root, setRoot] = useState(() => localStorage.getItem(LS.root) || '');
  const [prompt, setPrompt] = useState('');
  const [lines, setLines] = useState<Line[]>([]);
  const [busy, setBusy] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const history = useRef<Msg[]>([]);
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => { localStorage.setItem(LS.base, baseUrl); }, [baseUrl]);
  useEffect(() => { localStorage.setItem(LS.key, apiKey); }, [apiKey]);
  useEffect(() => { localStorage.setItem(LS.model, model); }, [model]);
  useEffect(() => { if (root) localStorage.setItem(LS.root, root); }, [root]);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [lines]);

  const push = (l: Line) => setLines((p) => [...p, l]);

  async function pickFolder() {
    const picked = await open({ directory: true, multiple: false, title: 'Open a project folder' });
    if (typeof picked === 'string') {
      setRoot(picked);
      history.current = [];
      setLines([]);
    }
  }

  async function send() {
    const text = prompt.trim();
    if (!text || busy) return;
    if (!root) { push({ kind: 'error', text: 'Open a folder first.' }); return; }
    if (!apiKey) { push({ kind: 'error', text: 'Add your gateway API key in Settings.' }); setShowSettings(true); return; }

    setPrompt('');
    push({ kind: 'you', text });
    setBusy(true);
    history.current.push({ role: 'user', content: text });

    try {
      history.current = await runAgent({
        baseUrl, apiKey, model, root,
        history: history.current,
        onEvent: (e) => push({ kind: e.kind, text: e.text }),
      });
    } catch (e) {
      push({ kind: 'error', text: String(e instanceof Error ? e.message : e) });
    } finally {
      setBusy(false);
    }
  }

  const folderName = root ? root.split(/[/\\]/).filter(Boolean).pop() : null;

  return (
    <div className="shell">
      <header className="bar">
        <div className="brand">
          <svg viewBox="0 0 64 64" aria-hidden="true">
            <rect x="2" y="2" width="60" height="60" rx="13" fill="url(#g)" />
            <defs>
              <linearGradient id="g" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#6D5CF0" /><stop offset=".55" stopColor="#5B4DE0" /><stop offset="1" stopColor="#8B5CF6" />
              </linearGradient>
            </defs>
            <path d="M17 22.5 L27 41.5 L37 22.5" fill="none" stroke="#fff" strokeWidth="5.2" strokeLinecap="round" strokeLinejoin="round" />
            <rect x="43.4" y="21.5" width="4.6" height="21" rx="2.3" fill="#fff" fillOpacity=".92" />
          </svg>
          <b>Vylo Editor</b>
        </div>
        <button className="folder" onClick={pickFolder} title={root || 'No folder open'}>
          {folderName ? `📁 ${folderName}` : 'Open folder…'}
        </button>
        <button className="ghost" onClick={() => setShowSettings((s) => !s)}>Settings</button>
      </header>

      {showSettings && (
        <div className="settings">
          <label>Gateway
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} spellCheck={false} />
          </label>
          <label>API key
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                   placeholder="sk-vylo-…" spellCheck={false} />
          </label>
          <label>Model
            <input value={model} onChange={(e) => setModel(e.target.value)} spellCheck={false} />
          </label>
          <p className="hint">Stored in this app only, on this machine.</p>
        </div>
      )}

      <div className="log" ref={log}>
        {lines.length === 0 && (
          <div className="empty">
            <p><b>Open a folder, then ask about the code in it.</b></p>
            <p>The agent reads files on this machine — nothing is uploaded except your question and the snippets it chooses to read.</p>
            <p className="muted">Read-only for now: it can explore and explain, but not edit or run commands.</p>
          </div>
        )}
        {lines.map((l, i) => (
          <div key={i} className={`line ${l.kind}`}>
            {l.kind === 'tool' && <span className="tag">tool</span>}
            {l.kind === 'result' && <span className="tag ok">result</span>}
            {l.kind === 'error' && <span className="tag err">error</span>}
            <span className="body">{l.text}</span>
          </div>
        ))}
        {busy && <div className="line working"><span className="dot" />working…</div>}
      </div>

      <div className="composer">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }}
          placeholder={root ? 'Ask about this codebase…   (⌘/Ctrl + Enter)' : 'Open a folder to begin'}
          rows={3}
          disabled={busy}
        />
        <button className="send" onClick={() => void send()} disabled={busy || !prompt.trim()}>Send</button>
      </div>
    </div>
  );
}
