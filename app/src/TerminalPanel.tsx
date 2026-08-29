import { useRef, useState } from 'react';
import { TerminalView, type TermHandle } from './TerminalView';
import { Icon } from './Icon';

/**
 * The terminal panel: tabs across the top, shells below.
 *
 * Every pane stays mounted while its tab is hidden. A terminal is a place you
 * leave a server running and come back to, so unmounting on tab switch would
 * throw away both the scrollback and the process.
 */

interface Tab { id: string; n: number; born: number; dead: boolean }

interface Props {
  root: string;
  dark: boolean;
  t: (s: string) => string;
  onSendToChat: (text: string) => void;
  /** Hide the panel. `drop` also means there is nothing left to keep alive. */
  onClose: (drop?: boolean) => void;
  full: boolean;
  onToggleFull: () => void;
  onError: (message: string) => void;
}

let seq = 0;
const newTab = (n: number): Tab => ({ id: `t${++seq}`, n, born: Date.now(), dead: false });

export function TerminalPanel({ root, dark, t, onSendToChat, onClose, onError, full, onToggleFull }: Props) {
  const [tabs, setTabs] = useState<Tab[]>(() => [newTab(1)]);
  const [active, setActive] = useState<string>(() => tabs[0].id);
  const handles = useRef(new Map<string, TermHandle>());

  function add() {
    const next = newTab(Math.max(0, ...tabs.map((x) => x.n)) + 1);
    setTabs((p) => [...p, next]);
    setActive(next.id);
  }

  function close(id: string) {
    handles.current.delete(id);
    const left = tabs.filter((x) => x.id !== id);
    // Closing the last shell means there is nothing to keep running, so the
    // panel is torn down rather than hidden -- reopening then starts fresh.
    if (!left.length) { onClose(true); return; }
    setTabs(left);
    if (id === active) setActive(left[left.length - 1].id);
  }

  /**
   * A shell that exits is finished, and closing its tab is what every terminal
   * does. The exception is one that dies the instant it starts — a broken
   * rc file, a shell that is not where the system says it is — where silently
   * closing the tab looks like the button did nothing. Those stay, with the
   * reason on screen.
   */
  function exited(tab: Tab) {
    if (Date.now() - tab.born < 800) {
      setTabs((p) => p.map((x) => (x.id === tab.id ? { ...x, dead: true } : x)));
      onError(t('The shell closed as soon as it started. Check your shell profile for an error.'));
      return;
    }
    close(tab.id);
  }

  function sendToChat() {
    const text = handles.current.get(active)?.text(200) ?? '';
    if (!text.trim()) return;
    onSendToChat(text);
  }

  const dead = tabs.find((x) => x.id === active)?.dead;

  return (
    <section className="panel" aria-label={t('Terminal')}>
      <div className="panel-bar">
        <div className="panel-tabs">
          {tabs.map((tab) => (
            <span key={tab.id} className={`ptab ${tab.id === active ? 'on' : ''} ${tab.dead ? 'dead' : ''}`}>
              <button className="ptab-name" onClick={() => setActive(tab.id)}>
                <span className="ptab-i"><Icon name="terminal" size={13} /></span>{t('Terminal')} {tab.n}
              </button>
              <button className="ptab-x" onClick={() => close(tab.id)}
                      aria-label={`${t('Close')} ${t('Terminal')} ${tab.n}`}><Icon name="close" size={12} /></button>
            </span>
          ))}
          <button className="ptab-add" onClick={add} title={t('New terminal')} aria-label={t('New terminal')}><Icon name="plus" size={13} /></button>
        </div>
        <div className="panel-acts">
          <button className="ghost" onClick={sendToChat} disabled={dead}
                  title={t('Copy the selection, or the last of the output, into the message box')}>
            {t('Send to chat')}
          </button>
          <button className="ghost" onClick={() => handles.current.get(active)?.clear()} disabled={dead}>
            {t('Clear')}
          </button>
          <button className="ghost icon" onClick={onToggleFull} aria-pressed={full}
                  title={t(full ? 'Restore the panel' : 'Fill the window')}
                  aria-label={t(full ? 'Restore the panel' : 'Fill the window')}><Icon name={full ? 'restore' : 'maximise'} size={14} /></button>
          <button className="ghost icon" onClick={() => onClose()} title={t('Hide the panel')} aria-label={t('Hide the panel')}><Icon name="chevron" size={14} turn={90} /></button>
        </div>
      </div>

      <div className="panel-body">
        {tabs.map((tab) => (
          <TerminalView
            key={tab.id}
            cwd={root}
            dark={dark}
            visible={tab.id === active}
            onReady={(h) => { if (h) handles.current.set(tab.id, h); else handles.current.delete(tab.id); }}
            onExit={() => exited(tab)}
            onError={onError}
          />
        ))}
      </div>
    </section>
  );
}

export default TerminalPanel;
