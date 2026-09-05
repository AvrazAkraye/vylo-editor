import { useEffect, useId, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Icon } from './Icon';
import { explain } from './errors';
import { isOpenable } from './github';
import { label, normalise } from './browser';

/**
 * What the dev server is serving, beside the code.
 *
 * An address bar, and a frame. The model of which addresses count, and how
 * one is completed or found, is `browser.ts`; this is the part that draws
 * it, and the decisions here are about the frame.
 *
 * ## A frame, not a second webview
 *
 * Tauri can open a second window on any URL, and that would be a browser.
 * An `<iframe>` in the app's own page is chosen instead because the app's
 * content-security policy governs it: `frame-src` names the loopback hosts
 * and nothing else, so even a bug in `normalise` could not put another site
 * in here — the webview would refuse the load. The model decides, and the
 * policy checks.
 *
 * ## What the sandbox allows, and what it withholds
 *
 * `allow-scripts` and `allow-same-origin`, because a dev server's page is an
 * application and needs its scripts, its storage and its cookies to behave as
 * it would in a browser. Together those two are only dangerous when the frame
 * is the *same* origin as the page holding it, and it never is: the app is
 * `tauri://localhost` (or `http://localhost:1420` under `tauri dev`), and the
 * frame is some other port on the loopback. A different origin cannot reach
 * the app's DOM, its `localStorage` — where the gateway key lives — or its
 * Tauri IPC, which is granted to the app's own origin only.
 *
 * `allow-forms` and `allow-modals`, because a page under development has
 * forms to submit and `alert()`s to fire, and a frame that swallows them is a
 * frame that lies about the page.
 *
 * Withheld: `allow-top-navigation`, so nothing in the frame can move the app
 * itself off to another page; `allow-popups`, so `window.open` does nothing;
 * `allow-downloads`, so the frame cannot put a file on disk — SAFETY.md's rule
 * is that nothing reaches disk without a person, and a download is a write.
 * The referrer policy is `no-referrer`, so the page under development is not
 * told the app's URL either.
 *
 * ## The address bar completes, and refuses
 *
 * Enter on `5173` shows `http://localhost:5173/`; Enter on the address already
 * showing reloads it; Enter on an empty field clears the pane. Enter on
 * anything that is not this machine is refused with a sentence saying what
 * is accepted, and the field keeps what was typed so it can be fixed. Escape
 * puts the current address back.
 *
 * ## Back and forward are the panel's
 *
 * The stack of addresses is kept here, not in the store, because it is a
 * session's worth of moving about and dies with the panel — the store keeps
 * *places*, in `recent`. Every address that arrives is a step: typed, picked
 * from the list, or found in the terminal by the app. A back or a forward
 * lands on a step that is already there, and is not pushed again.
 *
 * ## Opening outside
 *
 * The button hands the address to the same `open_url` command every link in
 * the app uses, which accepts https only — so it is greyed for a plain-http
 * dev server, with the reason in its tooltip, rather than offered and then
 * refused. `isOpenable` is the same check `App.tsx` makes before a link.
 */

interface Props {
  t: (s: string) => string;
  /** The address showing, or null for the empty state. Already normalised. */
  url: string | null;
  /** Addresses shown before, most recent first. Already normalised. */
  recent: string[];
  /** A new address to show — normalised — or null to clear the pane. */
  onUrl: (url: string | null) => void;
  onError: (message: string) => void;
}

/** Where you have been this session, and where in it you are. */
interface Stack {
  list: string[];
  at: number;
}

export function BrowserPanel({ t, url, recent, onUrl, onError }: Props) {
  const [draft, setDraft] = useState(url ?? '');
  const [stack, setStack] = useState<Stack>({ list: [], at: -1 });
  // Bumped to reload: a new key is a new element, and a new element loads.
  const [nonce, setNonce] = useState(0);
  const listId = useId();

  // The field follows the address — a pick from the list, a back, an address
  // the app found in the terminal. While the person is typing, `url` does not
  // change, so this never overwrites a draft mid-word.
  useEffect(() => { setDraft(url ?? ''); }, [url]);

  // Every address that arrives is a step, unless it is the step already
  // under foot — which is what a back or a forward lands on.
  useEffect(() => {
    if (!url) return;
    setStack((s) => (s.list[s.at] === url ? s : { list: [...s.list.slice(0, s.at + 1), url], at: s.at + 1 }));
  }, [url]);

  const canBack = stack.at > 0;
  const canForward = stack.at >= 0 && stack.at < stack.list.length - 1;

  function go(step: -1 | 1) {
    const at = stack.at + step;
    const target = stack.list[at];
    if (!target) return;
    setStack({ list: stack.list, at });
    onUrl(target);
  }

  function reload() {
    setNonce((n) => n + 1);
  }

  function submit() {
    const typed = draft.trim();
    if (!typed) { onUrl(null); return; }
    const next = normalise(typed);
    if (!next) {
      onError(t('Only an address on this machine can be shown here: localhost, 127.0.0.1 or a .localhost name, with any port.'));
      return;
    }
    if (next === url) reload();
    else onUrl(next);
  }

  function outside() {
    if (!url) return;
    // The same two steps as a link in the app: the check, then the command.
    if (!isOpenable(url)) { onError(t('That link cannot be opened.')); return; }
    void invoke('open_url', { url }).catch((e) => onError(explain(e, t('open that link'))));
  }

  const openable = !!url && isOpenable(url);

  return (
    <div className="br">
      <form className="br-bar" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <button type="button" className="sb-act br-nav" onClick={() => go(-1)} disabled={!canBack}
                title={t('Back')} aria-label={t('Back')}>
          <Icon name="chevron" size={13} turn={180} />
        </button>
        <button type="button" className="sb-act br-nav" onClick={() => go(1)} disabled={!canForward}
                title={t('Forward')} aria-label={t('Forward')}>
          <Icon name="chevron" size={13} />
        </button>
        <button type="button" className="sb-act" onClick={reload} disabled={!url}
                title={t('Reload')} aria-label={t('Reload')}>
          <Icon name="swap" size={13} />
        </button>
        <input className="br-url" value={draft} list={listId}
               onChange={(e) => setDraft(e.target.value)}
               onKeyDown={(e) => { if (e.key === 'Escape') setDraft(url ?? ''); }}
               placeholder="localhost:5173" spellCheck={false} autoCapitalize="off" autoCorrect="off"
               aria-label={t('Address of the dev server')} />
        <datalist id={listId}>
          {recent.map((u) => <option key={u} value={u} />)}
        </datalist>
        <button type="button" className="sb-act" onClick={outside} disabled={!openable}
                title={openable || !url ? t('Open in your browser') : t('Only an https address can be opened outside.')}
                aria-label={t('Open in your browser')}>
          <Icon name="link" size={13} />
        </button>
      </form>

      {url ? (
        <iframe key={nonce} className="br-frame" src={url}
                sandbox="allow-scripts allow-same-origin allow-forms allow-modals"
                referrerPolicy="no-referrer"
                title={t('What the dev server is serving')} />
      ) : (
        <div className="br-empty">
          <p className="ft-empty">{t('Type the address of your dev server, or run it in the terminal and pick it from what it prints.')}</p>
          {recent.length > 0 && (
            <>
              <div className="sb-sub">{t('Recent')}</div>
              {recent.map((u) => (
                <button key={u} className="ft-row" onClick={() => onUrl(u)} title={u}>
                  <span className="ft-icon"><Icon name="bolt" size={13} /></span>
                  <span className="ft-name">{label(u)}</span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export default BrowserPanel;
