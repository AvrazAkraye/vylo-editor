import { useEffect, useRef, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { runAgent, type Block, type CommandRequest, type Msg } from './agent';
import {
  attachFromFile, listenForDrops, previewUrl, toImageBlock, type Attached,
} from './attachments';
import { Pending, type Change } from './pending';
import { Review } from './Review';
import { invoke } from '@tauri-apps/api/core';
import { LANGS, storedLang, storeLang, translator, type Lang } from './i18n';
import { checkForUpdate, type Available } from './updates';
import { Markdown } from './Markdown';
import { ago, forget, load, recent, save, type Line as SavedLine } from './store';
import { FileTree, type Entry } from './FileTree';
import { Viewer } from './Viewer';
import { Section } from './Sidebar';

type Line = SavedLine & { shots?: Attached[] };

/**
 * A list rather than a text field. Anthropic writes "Opus 4.8" in prose but
 * `claude-opus-4-8` in the API, so a free-text box invites a dotted id and a
 * 404 the gateway can only pass along. The gateway now repairs that too, but
 * not offering the mistake is better than fixing it.
 */
const MODELS = [
  { id: 'claude-haiku-4-5', label: 'Haiku 4.5 — fastest, cheapest' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5 — balanced' },
  { id: 'claude-opus-4-8', label: 'Opus 4.8 — most capable' },
];

const LS = {
  base: 'vylo.baseUrl',
  key: 'vylo.apiKey',
  model: 'vylo.model',
  root: 'vylo.root',
};

export function App() {
  // capi is the gateway's own PUBLIC_BASE_URL and what the other Vylo clients
  // use. Both hosts front the same process; when streaming lands, capi needs
  // `flush_interval -1` in its Caddy block the way chat already has.
  const [baseUrl, setBaseUrl] = useState(() => localStorage.getItem(LS.base) || 'https://capi.vylo-tech.com');
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
  // The command the agent is waiting on, plus the resolver that unblocks it.
  const [askRun, setAskRun] = useState<CommandRequest | null>(null);
  const decide = useRef<((ok: boolean) => void) | null>(null);
  // Commands the user chose to stop being asked about. Session-only and matched
  // exactly: "always allow npm test" should not quietly also allow "npm test && rm -rf".
  const trusted = useRef(new Set<string>());
  // Files this session actually wrote, so the commit bar offers exactly those
  // rather than whatever else is dirty in the tree.
  const [written, setWritten] = useState<string[]>([]);
  const [commitMsg, setCommitMsg] = useState('');
  const [lang, setLang] = useState<Lang>(() => storedLang());
  const [update, setUpdate] = useState<Available | null>(null);
  const [updating, setUpdating] = useState<number | null | 'done'>(null);
  const [recents, setRecents] = useState(() => recent());
  const [tree, setTree] = useState<Entry[]>([]);
  const [tabs, setTabs] = useState<string[]>([]);          // open file paths
  const [active, setActive] = useState<string>('chat');    // 'chat' | a path
  const [sidebarW, setSidebarW] = useState(() => Number(localStorage.getItem('vylo.sbw')) || 248);
  const resizing = useRef(false);
  const t = translator(lang);
  const history = useRef<Msg[]>([]);
  const log = useRef<HTMLDivElement>(null);

  // Repair settings saved before either fix, so an existing install is not
  // stuck on a model id that 404s.
  useEffect(() => {
    const fixed = model.replace(/(\d)\.(\d)/g, '$1-$2');
    if (fixed !== model) setModel(fixed);
  }, [model]);

  useEffect(() => { localStorage.setItem(LS.base, baseUrl); }, [baseUrl]);
  useEffect(() => { localStorage.setItem(LS.key, apiKey); }, [apiKey]);
  useEffect(() => { localStorage.setItem(LS.model, model); }, [model]);
  useEffect(() => { if (root) localStorage.setItem(LS.root, root); }, [root]);
  useEffect(() => {
    storeLang(lang);
    // Tells the OS text stack which script to shape and which fonts to prefer.
    // dir stays ltr in every language, matching the OTP dashboard: only the
    // text runs right-to-left, and the browser does that on its own.
    document.documentElement.lang = lang;
  }, [lang]);

  // One check on launch, deliberately silent on failure -- an update check is
  // never a good reason to greet someone with an error.
  useEffect(() => { void checkForUpdate().then(setUpdate); }, []);

  // The tree is the sidebar's content and also what tells the user the folder
  // actually opened. Reloaded after edits land so new files appear.
  useEffect(() => {
    if (!root) { setTree([]); return; }
    let cancelled = false;
    void invoke<Entry[]>('list_tree', { root, maxEntries: 4000 })
      .then((e) => { if (!cancelled) setTree(e); })
      .catch(() => { if (!cancelled) setTree([]); });
    return () => { cancelled = true; };
  }, [root, written]);

  // Sidebar width, dragged from the divider.
  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!resizing.current) return;
      const w = Math.min(460, Math.max(180, e.clientX));
      setSidebarW(w);
    };
    const up = () => {
      if (!resizing.current) return;
      resizing.current = false;
      document.body.classList.remove('resizing');
      try { localStorage.setItem('vylo.sbw', String(sidebarW)); } catch { /* private mode */ }
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
    return () => { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up); };
  }, [sidebarW]);

  // Bring back the conversation for this folder. Runs on mount too, so
  // reopening the app lands you where you left off.
  useEffect(() => {
    if (!root) return;
    const prior = load(root);
    if (prior) {
      setLines(prior.lines);
      history.current = prior.history;
    }
  }, [root]);

  // Persist after the exchange settles rather than on every streamed line --
  // writing the whole transcript on each token would be wasteful and would
  // stutter a long reply.
  useEffect(() => {
    if (!root || busy) return;
    if (!lines.length && !history.current.length) return;
    save(root, lines.map(({ shots: _shots, ...l }) => l), history.current);
    setRecents(recent());
  }, [root, busy, lines]);
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

  const push = (l: Line) => setLines((p) => [...p, { at: Date.now(), ...l }]);

  async function newBranch() {
    const suggested = `vylo/${new Date().toISOString().slice(0, 10)}`;
    const name = window.prompt(t('New branch name'), suggested);
    if (!name) return;
    try {
      await invoke('git_create_branch', { root, name });
      setGit(await invoke('git_state', { root }));
      push({ kind: 'result', text: `Switched to branch ${name}` });
    } catch (e) {
      push({ kind: 'error', text: String(e) });
    }
  }

  async function commit() {
    if (!written.length || !commitMsg.trim()) return;
    setBusy(true);
    try {
      const r = await invoke<{ sha: string; summary: string }>('git_commit', {
        root, message: commitMsg.trim(), paths: written,
      });
      push({ kind: 'result', text: `Committed ${r.sha} — ${r.summary}` });
      setWritten([]);
      setCommitMsg('');
      setGit(await invoke('git_state', { root }));
    } catch (e) {
      push({ kind: 'error', text: String(e) });
    } finally {
      setBusy(false);
    }
  }

  /**
   * Suspend the agent loop until the user decides. Returning a promise the
   * button resolves is what keeps the whole thing inside one turn, so the model
   * can read the command's output immediately instead of the turn ending and
   * the context being re-sent.
   */
  function askToRun(req: CommandRequest): Promise<boolean> {
    if (trusted.current.has(req.command)) return Promise.resolve(true);
    setAskRun(req);
    return new Promise<boolean>((resolve) => {
      decide.current = (ok) => {
        decide.current = null;
        setAskRun(null);
        resolve(ok);
      };
    });
  }

  function openFolder(path: string) {
    setRoot(path);
    // Cleared here and repopulated by the restore effect above, so switching
    // between projects never shows one project's transcript against another's
    // files, even for a frame.
    history.current = [];
    setLines([]);
    setTabs([]);
    setActive('chat');
    // Staged edits are relative to the folder they were made against; carrying
    // them into a different project would be a way to write a file somewhere
    // nobody asked for.
    pending.current.clear();
    setChanges([]);
    setShots([]);
    // "Always allow" was granted against one project, not all of them.
    trusted.current.clear();
    setWritten([]);
    setCommitMsg('');
  }

  function openFile(path: string) {
    setTabs((prev) => (prev.includes(path) ? prev : [...prev, path]));
    setActive(path);
  }

  function closeTab(path: string) {
    setTabs((prev) => prev.filter((p) => p !== path));
    setActive((cur) => (cur === path ? 'chat' : cur));
  }

  function newChat() {
    if (!root) return;
    forget(root);
    history.current = [];
    setLines([]);
    setChanges([]);
    pending.current.clear();
    setRecents(recent());
  }

  async function pickFolder() {
    const picked = await open({ directory: true, multiple: false, title: t('Open a project folder') });
    if (typeof picked === 'string') openFolder(picked);
  }

  async function approve(paths: string[]) {
    setBusy(true);
    try {
      const done = await pending.current.apply(root, paths);
      setChanges(pending.current.list());
      setWritten((prev) => [...new Set([...prev, ...done])]);
      if (!commitMsg && done.length) {
        // A starting point, not a decision — the user edits it before committing.
        const name = done[0].split('/').pop() || done[0];
        setCommitMsg(done.length === 1 ? `Update ${name}` : `Update ${name} and ${done.length - 1} more`);
      }
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
    if (!root) { push({ kind: 'error', text: t('Open a folder first.') }); return; }
    if (!apiKey) { push({ kind: 'error', text: t('Add your gateway API key in Settings.') }); setShowSettings(true); return; }

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
        askToRun,
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
          {folderName ? `📁 ${folderName}` : t('Open folder…')}
        </button>
        {git?.is_repo && (
          <button className="ghost br" onClick={() => void newBranch()} title="Create a branch and switch to it">
            {t('+ branch')}
          </button>
        )}
        {git?.is_repo && (
          <span className={`git ${git.dirty ? 'dirty' : ''}`}
                title={git.dirty ? `${git.dirty} file(s) already modified before the agent touched anything` : 'Working tree is clean'}>
            {git.branch}{git.dirty ? ` · ${git.dirty} modified` : ''}
          </span>
        )}
        <button className="ghost" onClick={() => setShowSettings((s) => !s)}>{t('Settings')}</button>
      </header>

      {showSettings && (
        <div className="settings">
          <label>{t('Gateway')}
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} spellCheck={false} />
          </label>
          <label>{t('API key')}
            <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
                   placeholder="sk-vylo-…" spellCheck={false} />
          </label>
          <label>{t('Model')}
            <select value={MODELS.some((m) => m.id === model) ? model : 'custom'}
                    onChange={(e) => { if (e.target.value !== 'custom') setModel(e.target.value); }}>
              {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
              {!MODELS.some((m) => m.id === model) && <option value="custom">{model}</option>}
            </select>
          </label>
          <label>{t('Language')}
            <select value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
              {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
            </select>
          </label>
          <p className="hint">{t('Stored in this app only, on this machine.')}</p>
        </div>
      )}

      <div className="body">
        <aside className="sidebar" style={{ width: sidebarW }}>
          <Section id="files" title={t('Explorer')} count={tree.filter((e) => !e.is_dir).length}>
            {root
              ? <FileTree entries={tree} openPath={active === 'chat' ? null : active}
                          onOpen={openFile} changed={new Set(changes.map((c) => c.path))} />
              : <p className="ft-empty">{t('Open a folder, or drop one here')}</p>}
          </Section>

          <Section id="changes" title={t('Changes')} count={changes.length} defaultOpen={false}>
            {changes.length === 0
              ? <p className="ft-empty">{t('No proposed changes.')}</p>
              : changes.map((c) => (
                  <button key={c.path} className="ft-row ft-file changed" onClick={() => openFile(c.path)} title={c.path}>
                    <span className="ft-icon">±</span>
                    <span className="ft-name">{c.path.split('/').pop()}</span>
                    <span className="ft-dot" />
                  </button>
                ))}
          </Section>

          <Section id="chats" title={t('Chats')} count={recents.length} defaultOpen={false}
                   action={lines.length > 0
                     ? <button className="sb-act" onClick={newChat} title={t('Clear this conversation')}>+</button>
                     : undefined}>
            {recents.length === 0
              ? <p className="ft-empty">{t('No saved conversations.')}</p>
              : recents.map((r) => (
                  <button key={r.folder} className={`ft-row ft-file ${r.folder === root ? 'on' : ''}`}
                          onClick={() => openFolder(r.folder)} title={r.folder}>
                    <span className="ft-icon">✦</span>
                    <span className="ft-name">{r.name}</span>
                    <span className="rc-meta">{ago(r.updatedAt)}</span>
                  </button>
                ))}
          </Section>
        </aside>

        <div className="divider" onMouseDown={() => {
          resizing.current = true;
          document.body.classList.add('resizing');
        }} role="separator" aria-orientation="vertical" />

        <div className="work">
          <div className="tabs">
            <button className={`tab ${active === 'chat' ? 'on' : ''}`} onClick={() => setActive('chat')}>
              {t('Chat')}
            </button>
            {tabs.map((path) => (
              <span key={path} className={`tab ${active === path ? 'on' : ''}`}>
                <button className="tab-name" onClick={() => setActive(path)} title={path}>
                  {path.split('/').pop()}
                </button>
                <button className="tab-x" onClick={() => closeTab(path)} aria-label={`Close ${path}`}>×</button>
              </span>
            ))}
          </div>

          {active !== 'chat' ? (
            <Viewer root={root} path={active} />
          ) : (
          <div className="log" ref={log}>
        {lines.length === 0 && (
          <div className="empty">
            <p><b>{t('Open a folder, then ask about the code in it.')}</b></p>
            <p>{t('The agent reads files on this machine — nothing is uploaded except your question and the snippets it chooses to read.')}</p>
            <p className="muted">{t('It can propose edits and run your tests — you approve every change and every command first.')}</p>
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
            {l.kind === 'text'
              ? <div className="body"><Markdown text={l.text} /></div>
              : <span className="body">{l.text}</span>}
          </div>
        ))}
        {busy && <div className="line working"><span className="dot" />{t('working…')}</div>}
          </div>
          )}
        </div>
      </div>

      {update && (
        <div className="update">
          <span className="up-txt">
            <b>{t('Update available')}</b> — {update.version}
            {update.notes && <span className="up-notes">{update.notes}</span>}
          </span>
          <div className="up-btns">
            {updating === null ? (
              <>
                <button className="ghost" onClick={() => setUpdate(null)}>{t('Later')}</button>
                <button className="approve" onClick={() => {
                  setUpdating(0);
                  update.install((p) => setUpdating(p)).catch((e) => {
                    setUpdating(null);
                    push({ kind: 'error', text: String(e instanceof Error ? e.message : e) });
                  });
                }}>{t('Install and restart')}</button>
              </>
            ) : (
              <span className="up-progress">
                {updating === 'done' || updating === 100
                  ? t('Restarting…')
                  : typeof updating === 'number' ? `${updating}%` : t('Downloading…')}
              </span>
            )}
          </div>
        </div>
      )}

      {askRun && (
        <div className="ask" role="alertdialog" aria-label="Command approval">
          <div className="ask-in">
            <div className="ask-txt">
              <span className="ask-lbl">{t('Run this command?')}</span>
              <code>{askRun.command}</code>
              {askRun.reason && <span className="ask-why">{askRun.reason}</span>}
              <span className="ask-dir">{t('in')} {folderName}</span>
            </div>
            <div className="ask-btns">
              <button className="reject" onClick={() => decide.current?.(false)}>{t('Decline')}</button>
              <button className="ghost keep" onClick={() => {
                trusted.current.add(askRun.command);
                decide.current?.(true);
              }}>{t('Always allow this')}</button>
              <button className="approve" onClick={() => decide.current?.(true)}>{t('Run')}</button>
            </div>
          </div>
        </div>
      )}

      <Review changes={changes} onApprove={approve} onReject={reject} busy={busy} t={t} />

      {git?.is_repo && written.length > 0 && (
        <div className="commit">
          <span className="cm-lbl">
            {written.length} file{written.length > 1 ? 's' : ''} written
          </span>
          <input
            value={commitMsg}
            onChange={(e) => setCommitMsg(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void commit(); }}
            placeholder={t('Commit message')}
            aria-label="Commit message"
          />
          <button className="ghost" onClick={() => setWritten([])} disabled={busy}>{t('Not now')}</button>
          <button className="approve" onClick={() => void commit()} disabled={busy || !commitMsg.trim()}>
            Commit to {git.branch}
          </button>
        </div>
      )}

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

      {dragging && <div className="dropzone"><span>{t('Drop a folder to open it, or images to attach')}</span></div>}

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
                disabled={busy || (!prompt.trim() && shots.length === 0)}>{t('Send')}</button>
      </div>
    </div>
  );
}
