import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Icon } from './Icon';
import { fill } from './i18n';
import { explain } from './errors';
import type { Motion, Source } from './motiontypes';
import { sourceHost, sourceUrl } from './motionread';
import { askLine, clock, noteText, suggestions, webLine, type ChatEntry } from './motionstate';

export type { ChatEntry } from './motionstate';
export { noteText } from './motionstate';

/**
 * Talking to the graphic: the Ask tab.
 *
 * The person says what they want — "faster", "make the title bigger", "other
 * colours" — and the model answers with a sentence and the graphic changed
 * (motionai.ts `refineMotion`, motionchatops.ts). The panel applies the whole
 * answer as one undo step and puts both turns in the conversation; under the
 * answer, every change is a line with a tick, and every change asked for and
 * not made is a dimmed line saying why.
 *
 * This is the screen only. The run lives in the panel (MotionPanel.tsx), out
 * of React, so leaving the tab or closing the sidebar does not stop it; what
 * lives here is what the box holds and the message on its way, per graphic,
 * so a tab switch keeps a half-written message and a stopped one comes back
 * into the box.
 *
 * ## Nothing the model writes is run or rendered
 *
 * Its sentence is shown as text (React escapes it — never HTML); the graphic
 * it returns went through motionread.ts's repair before it got here. Nothing
 * reaches a file: that is Export's, pressed by the person.
 *
 * ## Where the facts came from
 *
 * When an answer searched the web (motionresearch.ts), a line under it says
 * what was looked up — or, plainly, why nothing was — and the pages the facts
 * came from are listed as links; a graphic made with facts from the web lists
 * its pages here too (`Motion.sources`) until the conversation has its own.
 * A link is opened only by the person pressing it, through the app's one way
 * to open an address — the `open_url` command, which takes nothing but
 * `https:` — and only an address `sourceUrl` reads as a public `https:` page.
 */

type T = (s: string) => string;

/** What the box holds, per graphic. */
const drafts = new Map<string, string>();
/** The message being answered, per graphic, and when it was sent: shown under the conversation until its answer is in it. */
const asked = new Map<string, { text: string; at: number }>();

function useSecond(on: boolean) {
  const [, set] = useState(0);
  useEffect(() => {
    if (!on) return;
    const i = window.setInterval(() => set((n) => n + 1), 1000);
    return () => window.clearInterval(i);
  }, [on]);
}

/**
 * The pages facts came from, as links: each its title and, beside it, its
 * site — the address the person can check before pressing — with the whole
 * address as the button's tooltip.
 */
function SourceLinks({ t, list, label, onError }: { t: T; list: readonly Source[]; label: string; onError(message: string): void }) {
  const open = (url: string) => {
    const safe = sourceUrl(url);
    if (!safe) return;
    void invoke('open_url', { url: safe }).catch((e: unknown) => onError(explain(e, t('open that link'))));
  };
  return (
    <ul className="mo-chat-sources" aria-label={label}>
      {list.map((s) => (
        <li key={s.url}>
          <button type="button" className="mo-chat-source" onClick={() => open(s.url)} title={s.url}>
            <Icon name="link" size={10} />
            <span className="mo-chat-source-title" dir="auto">{s.title}</span>
            <bdi className="mo-chat-source-site" dir="ltr">{sourceHost(s.url)}</bdi>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function MotionChat({ t, doc, ready, busy, looking = false, log, onSend, onStop, onProviders, onError }: {
  t: T;
  doc: Motion;
  /** A model can be asked: there is a key, or a local server. */
  ready: boolean;
  /** A message is being answered. */
  busy: boolean;
  /** The web is being searched for it. */
  looking?: boolean;
  log: ChatEntry[];
  onSend(text: string): void;
  onStop(): void;
  onProviders(): void;
  /** A link that could not be opened, said where the panel says its errors. */
  onError(message: string): void;
}): JSX.Element {
  const id = doc.id;
  const [text, setText] = useState(() => drafts.get(id) ?? '');
  const box = useRef<HTMLTextAreaElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const can = ready && !busy;
  const pending = busy ? asked.get(id) : undefined;
  useSecond(busy);

  const write = (s: string) => {
    drafts.set(id, s);
    setText(s);
  };

  // Answered, failed or stopped: the message is no longer on its way. One
  // stopped before its answer goes back into the box, unless something new
  // has been written there.
  useEffect(() => {
    if (busy) return;
    const p = asked.get(id);
    if (!p) return;
    asked.delete(id);
    const answered = log.some((e) => e.who === 'you' && e.at >= p.at && e.text === p.text);
    if (!answered && !(drafts.get(id) ?? '').trim()) write(p.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  // The box grows with what is typed, up to a few lines.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.blockSize = 'auto';
    el.style.blockSize = `${Math.min(el.scrollHeight, 168)}px`;
  }, [text]);

  // The newest turn in view.
  useLayoutEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [log.length, busy]);

  const go = (message: string) => {
    const m = message.trim();
    if (!can || !m) return;
    asked.set(id, { text: m, at: Date.now() });
    write('');
    onSend(m);
  };

  const stop = () => {
    onStop();
    requestAnimationFrame(() => box.current?.focus());
  };

  const lastYou = (before: number) => {
    for (let i = before - 1; i >= 0; i--) if (log[i].who === 'you') return log[i].text;
    return '';
  };
  const elapsed = pending ? Date.now() - pending.at : 0;
  const recipe = doc.recipe?.id;
  // The graphic's own pages, until an answer in the conversation lists its own: after Make it, or another session.
  const kept = doc.sources?.length && !log.some((e) => e.sources?.length) ? doc.sources : [];

  return (
    <div className="vid-chat mo-chat">
      {!ready && (
        <div className="sb-cta mo-chat-key">
          <p className="ft-empty">{t('Add an API key in Settings first.')}</p>
          <button className="ghost bordered" onClick={onProviders}>
            <Icon name="settings" size={13} />
            <span className="cta-label">{t('Open Settings')}</span>
          </button>
        </div>
      )}

      <ol className="vid-chat-log" ref={list} aria-live="polite" aria-label={t('Conversation with the graphic')}>
        {kept.length > 0 && (
          <li className="mo-chat-kept">
            <span dir="auto">{t('The facts in this graphic come from these pages:')}</span>
            <SourceLinks t={t} list={kept} label={t('Sources')} onError={onError} />
          </li>
        )}
        {log.length === 0 && !busy && (
          <li className="vid-chat-empty">
            <span className="vid-chat-empty-mark" aria-hidden="true"><Icon name="sparkle" size={16} /></span>
            <b>{t('Talk to your graphic')}</b>
            <span className="vid-chat-empty-what">
              {t('Say what to change in your own words — faster, bigger words, other colours, one more line. The model changes the graphic and lists every change under its answer; one undo takes a whole message back.')}
            </span>
          </li>
        )}
        {log.map((e, i) => (e.who === 'you'
          ? (
            <li key={`${e.at}-${i}`} className="vid-chat-turn is-you">
              <p className="vid-chat-text" dir="auto">{e.text}</p>
            </li>
          )
          : (
            <li key={`${e.at}-${i}`} className={`vid-chat-turn is-model${e.failed ? ' is-failed' : ''}`}>
              <span className="vid-chat-mark" aria-hidden="true"><Icon name={e.failed ? 'warning' : 'sparkle'} size={12} /></span>
              <div className="vid-chat-body">
                {e.text
                  ? <p className="vid-chat-text" dir="auto">{e.text}</p>
                  : !e.notes?.length && !e.skipped?.length && !e.web && <p className="vid-chat-text is-quiet">{t('Nothing needed changing.')}</p>}
                {(e.notes?.length || e.skipped?.length) ? (
                  <ul className="vid-chat-changes" aria-label={t('What changed')}>
                    {(e.notes ?? []).map((n, j) => (
                      <li key={`c${j}`} dir="auto"><Icon name="check" size={11} /><span>{noteText(n, t, recipe)}</span></li>
                    ))}
                    {(e.skipped ?? []).map((n, j) => (
                      <li key={`s${j}`} className="is-skipped" dir="auto"><Icon name="warning" size={11} /><span>{noteText(n, t, recipe)}</span></li>
                    ))}
                  </ul>
                ) : null}
                {e.web && (
                  <p className={`mo-chat-web${e.web.found ? '' : ' is-missed'}`} dir="auto">
                    <Icon name={e.web.found ? 'search' : 'warning'} size={11} />
                    <span>{webLine(e.web, t)}</span>
                  </p>
                )}
                {e.sources?.length ? <SourceLinks t={t} list={e.sources} label={t('Sources')} onError={onError} /> : null}
                {e.failed && i === log.length - 1 && !busy && lastYou(i) && (
                  <span className="vid-chat-again">
                    <button type="button" className="ghost bordered" disabled={!can} onClick={() => go(lastYou(i))}>
                      {t('Try again')}
                    </button>
                  </span>
                )}
              </div>
            </li>
          )))}
        {pending && (
          <li className="vid-chat-turn is-you is-pending">
            <p className="vid-chat-text" dir="auto">{pending.text}</p>
          </li>
        )}
        {busy && (
          <li className="vid-chat-turn is-model is-working" role="status">
            <span className="vid-chat-mark" aria-hidden="true"><span className="vid-glyph">✻</span></span>
            <div className="vid-chat-status">
              <b>{askLine(elapsed, t, looking)}</b>
              {/* Not read out: in the conversation's live region a clock would be said again every second. */}
              <span className="vid-chat-clock" aria-hidden="true">
                <span>{fill(t('Running for {time}'), { time: clock(elapsed) })}</span>
              </span>
            </div>
          </li>
        )}
      </ol>

      {log.length === 0 && !busy && !text.trim() && (
        <div className="vid-chat-chips" role="group" aria-label={t('Suggestions')}>
          {suggestions(t).map((s) => (
            <button key={s} type="button" className="vid-chat-chip" disabled={!can} onClick={() => go(s)} dir="auto">{s}</button>
          ))}
        </div>
      )}

      <form className={`vid-chat-compose${can ? '' : ' is-off'}`} onSubmit={(e) => { e.preventDefault(); go(text); }}>
        <textarea ref={box} value={text} dir="auto" rows={1} disabled={!ready}
                  placeholder={ready ? t('Tell the graphic what to change…') : ''} aria-label={t('Message to the graphic')}
                  onChange={(e) => write(e.target.value)}
                  onKeyDown={(e) => {
                    // Enter sends, as in every chat here, and so does ⌘/Ctrl+Enter; Shift+Enter is a new line.
                    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      go(text);
                    }
                  }} />
        {busy
          ? (
            <button type="button" className="vid-chat-send is-stop" onClick={stop} title={t('Stop')} aria-label={t('Stop')}>
              <Icon name="stop" size={14} />
            </button>
          )
          : (
            <button type="submit" className="vid-chat-send" disabled={!can || !text.trim()} title={t('Send')} aria-label={t('Send')}>
              <Icon name="send" size={13} />
            </button>
          )}
      </form>
      <p className="vid-chat-hint">{t('Enter sends · Shift+Enter adds a line · one undo takes a whole message back')}</p>
    </div>
  );
}
