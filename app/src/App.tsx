import { useEffect, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { runAgent, type Block, type Msg } from './agent';
import {
  attachFromFile, listenForDrops, previewUrl, toImageBlock, type Attached,
} from './attachments';
import { Pending, type Change } from './pending';
import { Review } from './Review';
import { invoke } from '@tauri-apps/api/core';

type Line = {
  kind: 'you' | 'text' | 'tool' | 'result' | 'error';
  text: string;
  shots?: Attached[];
};

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
  const [shots, setShots] = useState<Attached[]>([]);
  const [dragging, setDragging] = useState(false);
  const [changes, setChanges] = useState<Change[]>([]);
  const [git, setGit] = useState<{ is_repo: boolean; branch: string; dirty: number } | null>(null);
  const pending = useRef(new Pending());
  const history = useRef<Msg[]>([]);
  const log = useRef<HTMLDivElement>(null);

  useEffect(() => { localStorage.setItem(LS.base, baseUrl); }, [baseUrl]);
  useEffect(() => { localStorage.setItem(LS.key, apiKey); }, [apiKey]);
  useEffect(() => { localStorage.setItem(LS.model, model); }, [model]);
  useEffect(() => { if (root) localStorage.setItem(LS.root, root); }, [root]);
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight }); }, [lines, changes]);

  // Whether git is available as an undo is worth knowing *before* approving,
  // not after.
  useEffect(() => {
    if (!root) { setGit(null); return; }
    void invoke<{ is_repo: boolean; branch: string; dirty: number }>('git_state', { root })
      .then(setGit).catch(() => setGit(null));
  }, [root, changes]);

  // Drag-and-drop is a window-level OS event, not an HTML5 one: Tauri
  // intercepts the drop before the webview sees it.
  useEffect(() => {
    let stop: (() => void) | undefined;
    void listenForDrops({
      onFolder: (path) => { openFolder(path); },
      onImages: (imgs) => setShots((p) => [...p, ...imgs]),
      onHover: setDragging,
      onError: (m) => push({ kind: 'error', text: m }),
    }).then((un) => { stop = un; });
    return () => stop?.();
  }, []);

  // Pasting a screenshot is the common case and it has no path at all, so it
  // never reaches the Rust side -- the blob is read here instead.
  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files || []);
      const imgs = files.filter((f) => f.type.startsWith('image/'));
      if (!imgs.length) return;
      e.preventDefault();
      for (const f of imgs) {
        try {
          const a = await attachFromFile(f);
          setShots((p) => [...p, a]);
        } catch (err) {
          push({ kind: 'error', text: String(err instanceof Error ? err.message : err) });
        }
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, []);

  const push = (l: Line) => setLines((p) => [...p, l]);

  function openFolder(path: string) {
    setRoot(path);
    history.current = [];
    setLines([]);
    // Staged edits are relative to the folder they were made against; carrying
    // them into a different project would be a way to write a file somewhere
    // nobody asked for.
    pending.current.clear();
    setChanges([]);
    setShots([]);
  }

  async function pickFolder() {
    const picked = await open({ directory: true, multiple: false, title: 'Open a project folder' });
    if (typeof picked === 'string') openFolder(picked);
  }

  async function approve(paths: string[]) {
    setBusy(true);
    try {
      const done = await pending.current.apply(root, paths);
      setChanges(pending.current.list());
      push({ kind: 'result', text: `Wrote ${done.length} file${done.length === 1 ? '' : 's'}: ${done.join(', ')}` });
      // Tell the agent what landed, so a follow-up turn knows the state of the
      // disk rather than assuming its proposal is still pending.
      history.current.push({
        role: 'user',
        content: `[The user approved and wrote: ${done.join(', ')}. These changes are now on disk.]`,
      });
    } catch (e) {
      push({ kind: 'error', text: String(e instanceof Error ? e.message : e) });
    } finally {
      setBusy(false);
    }
  }

  function reject(paths: string[]) {
    paths.forEach((p) => pending.current.drop(p));
    setChanges(pending.current.list());
    push({ kind: 'result', text: `Discarded ${paths.length} proposed change${paths.length === 1 ? '' : 's'}.` });
    history.current.push({
      role: 'user',
      content: `[The user discarded your proposed changes to: ${paths.join(', ')}. Do not re-apply them unless asked.]`,
    });
  }

  async function send() {
    const text = prompt.trim();
    // An image on its own is a legitimate message -- "what is wrong here?"
    // with a screenshot needs no words.
    if ((!text && shots.length === 0) || busy) return;
    if (!root) { push({ kind: 'error', text: 'Open a folder first.' }); return; }
    if (!apiKey) { push({ kind: 'error', text: 'Add your gateway API key in Settings.' }); setShowSettings(true); return; }

    setPrompt('');
    push({ kind: 'you', text, shots: shots.length ? [...shots] : undefined });
    setBusy(true);

    // Images ride in the same user turn as the question, before the text, so
    // the model reads the picture and then what is being asked about it.
    const content: Block[] | string = shots.length
      ? [...shots.map(toImageBlock), { type: 'text' as const, text }]
      : text;
    history.current.push({ role: 'user', content });
    setShots([]);

    try {
      history.current = await runAgent({
        baseUrl, apiKey, model, root,
        history: history.current,
        pending: pending.current,
        onEvent: (e) => push({ kind: e.kind, text: e.text }),
        onStaged: () => setChanges(pending.current.list()),
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
        {git?.is_repo && (
          <span className={`git ${git.dirty ? 'dirty' : ''}`}
                title={git.dirty ? `${git.dirty} file(s) already modified before the agent touched anything` : 'Working tree is clean'}>
            {git.branch}{git.dirty ? ` · ${git.dirty} modified` : ''}
          </span>
        )}
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
            <p className="muted">It can propose edits — you review every change as a diff before anything is written.</p>
          </div>
        )}
        {lines.map((l, i) => (
          <div key={i} className={`line ${l.kind}`}>
            {l.shots && (
              <div className="shots sent">
                {l.shots.map((a) => <img key={a.id} src={previewUrl(a)} alt={a.name} />)}
              </div>
            )}
            {l.kind === 'tool' && <span className="tag">tool</span>}
            {l.kind === 'result' && <span className="tag ok">result</span>}
            {l.kind === 'error' && <span className="tag err">error</span>}
            <span className="body">{l.text}</span>
          </div>
        ))}
        {busy && <div className="line working"><span className="dot" />working…</div>}
      </div>

      <Review changes={changes} onApprove={approve} onReject={reject} busy={busy} />

      {shots.length > 0 && (
        <div className="tray">
          {shots.map((a) => (
            <div className="chip" key={a.id}>
              <img src={previewUrl(a)} alt="" />
              <span className="nm">{a.name}</span>
              <button onClick={() => setShots((p) => p.filter((x) => x.id !== a.id))}
                      aria-label={`Remove ${a.name}`}>×</button>
            </div>
          ))}
        </div>
      )}

      {dragging && <div className="dropzone"><span>Drop a folder to open it, or images to attach</span></div>}

      <div className="composer">
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void send(); } }}
          placeholder={root
            ? 'Ask about this codebase…   ⌘/Ctrl+Enter to send · drop or paste images'
            : 'Open a folder, or drop one here'}
          rows={3}
          disabled={busy}
        />
        <button className="send" onClick={() => void send()}
                disabled={busy || (!prompt.trim() && shots.length === 0)}>Send</button>
      </div>
    </div>
  );
}
