import { Icon } from './Icon';
import { ago } from './store';
import { SignIn } from './SignIn';

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

/**
 * macOS writes ⌘; everywhere else it is Ctrl, and showing ⌘ there is a lie.
 *
 * Exported, because these are not the key map's private business: anywhere a
 * shortcut is printed — the composer hint, a button's `kbd`, a tooltip — has
 * the same two choices to make, and a hardcoded ⌘ in one of them tells a
 * Windows user to press a key their keyboard does not have. Import these
 * rather than typing the glyph.
 */
export const IS_MAC = typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent);
export const MOD = IS_MAC ? '⌘' : 'Ctrl';
export const ALT = IS_MAC ? '⌃' : 'Ctrl';

/**
 * Only shortcuts that actually work. An unbuilt one advertised here is a bug —
 * ⌘K was deliberately absent until E1 shipped, and was added the day it did.
 */
export function shortcuts(t: (s: string) => string): { keys: string; what: string }[] {
  return [
    { keys: `${MOD}P`, what: t('Search everything…') },
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
  /**
   * A finished setup, from whichever route: the session token and the key to
   * talk to the model with. Either may be `''` — see `SignIn`'s own note, and
   * the guard in `App.tsx` that stops an empty one overwriting a live one.
   */
  onSignedIn: (token: string, key: string) => void;
  t: (s: string) => string;
}

export function Welcome({ recents, onOpen, onOpenFolder, apiKey, baseUrl, onSignedIn, t }: Props) {
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

        {!apiKey && <SignIn baseUrl={baseUrl} onSignedIn={onSignedIn} t={t} />}

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
                  {r.chats} {r.chats === 1 ? t('chat') : t('chats')} · {ago(r.updatedAt, t)}
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
