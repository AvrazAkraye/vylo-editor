import { useEffect, useMemo, useRef, useState } from 'react';
import { Icon, type IconName } from './Icon';
import { fill } from './i18n';
import { loadDocs } from './researchstore';
import { destinations, route, type Dest, type DocRef } from './askroute';

/**
 * Ask Vylo: the one box that sends what you ask to the part of the app that
 * does it (askroute.ts routes it). Opened from the title bar's Ask button or
 * with ⌘⇧A, from anywhere.
 *
 * The destination is shown before anything happens, with the phrase that
 * chose it, and can be changed; so can the document, where one is used. The
 * box sends nothing itself: `onSend` hands the words to the module, which
 * starts its own run exactly as its own form would.
 */

type T = (s: string) => string;
type Studio = 'research' | 'video' | 'motion' | 'slides';

const ICON: Readonly<Record<Dest, IconName>> = { research: 'book', 'doc-chat': 'chat', video: 'film', motion: 'motion', slides: 'slides', chat: 'sparkle' };

function destName(d: Dest, t: T): string {
  if (d === 'research') return t('New research document');
  if (d === 'doc-chat') return t('Ask one of your documents');
  if (d === 'video') return t('New video');
  if (d === 'motion') return t('New motion graphic');
  if (d === 'slides') return t('New presentation');
  return t('Chat');
}

function destAbout(d: Dest, t: T): string {
  if (d === 'research') return t('Planned, sourced and written as the Research form would — with footnotes and a reference list.');
  if (d === 'doc-chat') return t('Sent to that document’s Chat tab: answered from it, or changed as you ask.');
  if (d === 'video') return t('A storyboard planned from your words, to preview, edit and export.');
  if (d === 'motion') return t('An animated graphic from your words — a title, a lower third, a chart — to preview, edit and export.');
  if (d === 'slides') return t('Slides from your words — or from one of your documents, with its sources.');
  return t('Put in the chat box, for you to send.');
}

export function AskVylo({ t, on, onClose, onSend }: {
  t: T;
  /** The studios switched on. */
  on: ReadonlySet<Studio>;
  onClose: () => void;
  onSend: (dest: Dest, text: string, docId?: string) => void;
}) {
  const [text, setText] = useState('');
  const [docs, setDocs] = useState<(DocRef & { written: boolean })[]>([]);
  const [chosen, setChosen] = useState<Dest | null>(null);
  const [docSet, setDocSet] = useState<string | null>(null);
  // Slides can start from words; set when the person picks "from words" for slides the router sent to a document.
  const [wordsOnly, setWordsOnly] = useState(false);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    box.current?.focus();
    let live = true;
    void loadDocs().then((list) => {
      if (live) setDocs(list.map((d) => ({ id: d.id, title: d.meta.title || d.request, kind: d.kind, updated: d.updated, written: d.sections.some((s) => s.state === 'done') })));
    });
    return () => { live = false; };
  }, []);

  const refs = useMemo(() => docs.filter((d) => d.written), [docs]);
  const found = useMemo(() => route(text, { docs: refs, on }), [text, refs, on]);
  const offered = destinations(on, refs.length > 0);
  const dest: Dest = chosen && offered.includes(chosen) ? chosen : found.dest;
  const needsDoc = dest === 'doc-chat' || (dest === 'slides' && !wordsOnly && (docSet !== null || !!found.docId));
  const docId = needsDoc ? (docSet ?? found.docId ?? refs[0]?.id) : undefined;
  const ready = text.trim().length > 0 && (dest !== 'doc-chat' || !!docId);

  const send = () => {
    if (!ready) return;
    onSend(dest, text.trim(), docId);
    onClose();
  };

  return (
    <div className="askv-scrim" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="askv" role="dialog" aria-modal="true" aria-label={t('Ask Vylo')}
           onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } }}>
        <header className="askv-head">
          <span className="askv-mark" aria-hidden="true"><Icon name="sparkle" size={14} /></span>
          <b>{t('Ask Vylo')}</b>
          <small>{t('Write a thesis, make a video, slides or a motion graphic, ask one of your documents — or anything else.')}</small>
        </header>
        <textarea ref={box} className="askv-box" dir="auto" rows={3} value={text} onChange={(e) => setText(e.target.value)}
                  placeholder={t('For example: a working paper on federalism in Sorani · slides from my thesis · a 30-second video about our college')}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(); } }} />

        <div className="askv-dests" role="radiogroup" aria-label={t('Where it goes')}>
          {offered.map((d) => (
            <button key={d} type="button" role="radio" aria-checked={dest === d} className={dest === d ? 'on' : ''}
                    onClick={() => { setChosen(d); if (d !== 'slides') setWordsOnly(false); }}>
              <Icon name={ICON[d]} size={13} />
              <span>{destName(d, t)}</span>
            </button>
          ))}
        </div>

        <p className="askv-why" dir="auto">
          <Icon name={chosen ? 'check' : found.phrase ? 'bolt' : 'sparkle'} size={11} />
          {chosen
            ? t('Chosen by you.')
            : found.phrase
              ? fill(t('Chosen by “{phrase}” in your words.'), { phrase: found.phrase })
              : text.trim() ? t('Nothing names a studio, so it goes to the chat.') : t('It goes where your words say.')}
          {' '}
          {destAbout(dest, t)}
        </p>

        {(dest === 'doc-chat' || dest === 'slides') && refs.length > 0 && (
          <label className="askv-doc">
            <span>{dest === 'slides' ? t('From') : t('Document')}</span>
            <select value={needsDoc ? docId ?? '' : ''} onChange={(e) => {
              if (!e.target.value) { setWordsOnly(true); setDocSet(null); } else { setWordsOnly(false); setDocSet(e.target.value); }
            }}>
              {dest === 'slides' && <option value="">{t('Your words only')}</option>}
              {refs.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
            </select>
          </label>
        )}

        <footer className="askv-foot">
          <small>{t('Enter sends · Shift+Enter adds a line · Esc closes')}</small>
          <button type="button" className="ghost" onClick={onClose}>{t('Cancel')}</button>
          <button type="button" className="sb-cta-go" disabled={!ready} onClick={send}>
            <Icon name={ICON[dest]} size={12} />{dest === 'chat' ? t('Put it in the chat') : t('Start')}
          </button>
        </footer>
      </div>
    </div>
  );
}
