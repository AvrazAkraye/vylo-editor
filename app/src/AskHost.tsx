import { useEffect, useRef, useState } from 'react';
import { subscribe, dismiss, type Pending } from './ask';

/**
 * The one dialog the app draws for itself, because the webview draws none.
 *
 * Mounted once. Everything that used to call `window.prompt` or
 * `window.confirm` now awaits `ask.text` / `ask.confirm`, and this renders
 * whatever is waiting.
 *
 * It keeps what D7 paid for and the browser dialogs never had: Escape from
 * anywhere inside, focus returned to where it came from, a real `role="dialog"`,
 * and a visible focus ring. The field is selected on open, so a rename can be
 * typed straight over — which is the one thing `window.prompt` did well.
 */
export function AskHost({ t }: { t: (s: string) => string }) {
  const [now, setNow] = useState<Pending | null>(null);
  const [draft, setDraft] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const came = useRef<Element | null>(null);

  useEffect(() => subscribe((p) => {
    setNow(p);
    if (p?.ask.kind === 'text') setDraft(p.ask.value);
  }), []);

  useEffect(() => {
    if (!now) {
      // Put focus back where the question interrupted. A dialog that dumps the
      // caret at the top of the document is the difference between carrying on
      // and starting again.
      (came.current as HTMLElement | null)?.focus?.();
      came.current = null;
      return;
    }
    came.current = document.activeElement;
    const id = window.setTimeout(() => { field.current?.focus(); field.current?.select(); }, 0);
    return () => window.clearTimeout(id);
  }, [now]);

  if (!now) return null;
  const { ask, settle } = now;
  const isText = ask.kind === 'text';

  return (
    <div className="pal-back" onMouseDown={() => dismiss()}>
      <div className="pal askbox" role="dialog" aria-modal="true" aria-label={ask.title}
           onMouseDown={(e) => e.stopPropagation()}
           onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); dismiss(); } }}>
        <h2 className="ask-title">{ask.title}</h2>

        {!isText && ask.body && <p className="ask-body">{ask.body}</p>}

        {isText && (
          <form onSubmit={(e) => { e.preventDefault(); settle(draft); }}>
            <input ref={field} className="ask-field" value={draft}
                   onChange={(e) => setDraft(e.target.value)}
                   placeholder={ask.placeholder} aria-label={ask.title} spellCheck={false} />
          </form>
        )}

        <div className="ask-acts">
          <button className="ghost" onClick={() => dismiss()}>{t('Cancel')}</button>
          <button className={!isText && ask.danger ? 'reject' : 'approve'}
                  onClick={() => settle(isText ? draft : true)}
                  /* An empty rename is a cancel with extra steps, so it cannot
                     be pressed rather than being accepted and then rejected
                     somewhere the person cannot see. */
                  disabled={isText && !draft.trim()}>
            {ask.confirmLabel ?? (isText ? t('Save') : t('Confirm'))}
          </button>
        </div>
      </div>
    </div>
  );
}

export default AskHost;
