import { useState } from 'react';
import { Icon } from './Icon';
import { ago } from './store';
import { checkKey, type KeyCheck } from './gateway';

/**
 * The first screen.
 *
 * With no folder open there was an empty chat and a sentence telling you to
 * open one — a screen whose only purpose was to say that the screen was not
 * useful yet. There is exactly one thing to do at that point, so this shows
 * exactly that: the button, the projects you have opened before, and the keys
 * that will not be discoverable any other way.
 *
 * The composer is hidden while this is up rather than sitting there rejecting
 * every message with "open a folder first". Removing the error is better than
 * wording it well.
 */

/** macOS writes ⌘; everywhere else it is Ctrl, and showing ⌘ there is a lie. */
export const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);
const MOD = IS_MAC ? '⌘' : 'Ctrl';
const ALT = IS_MAC ? '⌃' : 'Ctrl';

/**
 * Only shortcuts that actually work. An unbuilt one advertised here is a bug —
 * ⌘K was deliberately absent until E1 shipped, and was added the day it did.
 */
export function shortcuts(t: (s: string) => string): { keys: string; what: string }[] {
  return [
    { keys: `${MOD}P`, what: t('Go to file') },
    { keys: `${MOD}T`, what: t('Go to symbol') },
    { keys: `${MOD}⇧F`, what: t('Search the project') },
    { keys: 'F12', what: t('Go to definition') },
    { keys: IS_MAC ? '⌃-' : 'Alt+←', what: t('Back') },
    { keys: `${ALT}\``, what: t('Terminal') },
    { keys: `${ALT}⇧\``, what: t('Terminal fills the window') },
    { keys: `${MOD}K`, what: t('Edit the selection') },
    { keys: `${MOD}S`, what: t('Save the open file') },
    { keys: `${MOD}↵`, what: t('Send a message') },
    { keys: `${MOD}⇧D`, what: t('Switch theme') },
  ];
}

export function Shortcuts({ t, columns = 2 }: { t: (s: string) => string; columns?: number }) {
  return (
    <dl className="keys" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {shortcuts(t).map((s) => (
        <div className="keys-row" key={s.keys}>
          <dt><kbd>{s.keys}</kbd></dt>
          <dd>{s.what}</dd>
        </div>
      ))}
    </dl>
  );
}

interface Recent { folder: string; name: string; updatedAt: number; chats: number }

interface Props {
  recents: Recent[];
  onOpen: () => void;
  onOpenFolder: (path: string) => void;
  /** Empty until the gateway key is set, which is what the first screen asks for. */
  apiKey: string;
  baseUrl: string;
  onKey: (key: string) => void;
  t: (s: string) => string;
}

/**
 * The one thing needed, when it is the only thing needed.
 *
 * Without a key you could open a folder, read the code, type a question, and
 * only then be told to go to Settings. Asking here costs one screen and saves
 * that. It does not *block* opening a folder, because the editor and the
 * terminal work perfectly well without a key and someone may only want those.
 */
function KeySetup({ baseUrl, onKey, t }: { baseUrl: string; onKey: (k: string) => void; t: (s: string) => string }) {
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<KeyCheck | null>(null);

  async function connect() {
    setBusy(true);
    setResult(null);
    const r = await checkKey(baseUrl, key);
    setResult(r);
    setBusy(false);
    // A key that is right but blocked — no plan, suspended, rate limited — is
    // still the right key, so it is saved. Only a rejected one is withheld.
    if (r.state === 'ok' || r.state === 'ok-but' || r.state === 'unknown') onKey(key.trim());
  }

  return (
    <section className="wc-key">
      <h2>{t('Connect to your gateway')}</h2>
      <p className="wc-key-note">
        {t('Vylo Editor talks to your own gateway. Paste the key from your account to let the agent answer.')}
      </p>
      <div className="wc-key-row">
        <input
          type="password"
          value={key}
          onChange={(e) => { setKey(e.target.value); setResult(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && key.trim()) void connect(); }}
          placeholder="sk-vylo-…"
          spellCheck={false}
          autoFocus
        />
        <button className="approve" onClick={() => void connect()} disabled={busy || !key.trim()}>
          {busy ? t('Checking…') : t('Connect')}
        </button>
      </div>
      {result && result.state !== 'ok' && (
        <p className={`wc-key-said ${result.state === 'bad' ? 'bad' : ''}`}>
          {result.note} {result.fix}
        </p>
      )}
      {result?.state === 'ok' && <p className="wc-key-said good">{t('Connected.')}</p>}
    </section>
  );
}

export function Welcome({ recents, onOpen, onOpenFolder, apiKey, baseUrl, onKey, t }: Props) {
  return (
    <div className="welcome">
      <div className="wc-inner">
        <header className="wc-head">
          <svg viewBox="0 0 64 64" aria-hidden="true" className="wc-mark">
            <rect x="2" y="2" width="60" height="60" rx="13" fill="url(#wg)" />
            <defs>
              <linearGradient id="wg" x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
                <stop offset="0" stopColor="#6D5CF0" /><stop offset=".55" stopColor="#5B4DE0" /><stop offset="1" stopColor="#8B5CF6" />
              </linearGradient>
            </defs>
            <path d="M17 22.5 L27 41.5 L37 22.5" fill="none" stroke="#fff" strokeWidth="5.2" strokeLinecap="round" strokeLinejoin="round" />
            <rect x="43.4" y="21.5" width="4.6" height="21" rx="2.3" fill="#fff" fillOpacity=".92" />
          </svg>
          <h1>Vylo Editor</h1>
          <p>{t('An agent that works on a folder on this machine. Your code stays here — only your question and the snippets it chooses to read are sent.')}</p>
        </header>

        {!apiKey && <KeySetup baseUrl={baseUrl} onKey={onKey} t={t} />}

        <button className={`wc-open ${apiKey ? '' : 'second'}`} onClick={onOpen}>
          <Icon name="folder" size={16} />
          {t('Open a folder')}
        </button>
        <p className="wc-drop">{t('or drop one onto this window')}</p>

        {recents.length > 0 && (
          <section className="wc-recent">
            <h2>{t('Recent')}</h2>
            {recents.slice(0, 6).map((r) => (
              <button key={r.folder} className="wc-row" onClick={() => onOpenFolder(r.folder)} title={r.folder}>
                <Icon name="folder" size={14} />
                <span className="wc-name">{r.name}</span>
                {/* The directory reads right-to-left so the tail — the part that
                    distinguishes two folders with the same name — survives the
                    ellipsis instead of the useless leading /Users/… */}
                <span className="wc-path">{r.folder}</span>
                <span className="wc-meta">
                  {r.chats} {r.chats === 1 ? t('chat') : t('chats')} · {ago(r.updatedAt)}
                </span>
              </button>
            ))}
          </section>
        )}

        <section className="wc-keys">
          <h2>{t('Keys')}</h2>
          <Shortcuts t={t} />
        </section>
      </div>
    </div>
  );
}
