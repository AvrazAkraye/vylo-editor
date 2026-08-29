import { useEffect, useRef, useState } from 'react';
import { TerminalView, type TermHandle } from './TerminalView';
import { readable } from './ansi';
import { Icon } from './Icon';

/**
 * The terminal panel: tabs across the top, shells below.
 *
 * Every pane stays mounted while its tab is hidden. A terminal is a place you
 * leave a server running and come back to, so unmounting on tab switch would
 * throw away both the scrollback and the process.
 */

interface Tab {
  id: string; n: number; born: number; dead: boolean;
  /** Set when this pane exists to run one approved command. */
  command?: string;
}

/** What a command pane reports back to the agent once it finishes. */
export interface CommandResult { code: number | null; output: string; truncated: boolean }

interface Props {
  root: string;
  dark: boolean;
  t: (s: string) => string;
  onSendToChat: (text: string) => void;
  /** Hide the panel. `drop` also means there is nothing left to keep alive. */
  onClose: (drop?: boolean) => void;
  full: boolean;
  onToggleFull: () => void;
  /** Hands the composer a way to read the active pane, for `@terminal`. */
  expose: (getText: (() => string) | null) => void;
  /** Hands the approval flow a way to run a command in a visible pane. */
  exposeRun: (run: ((command: string) => Promise<CommandResult>) | null) => void;
  onError: (message: string) => void;
}

let seq = 0;
const newTab = (n: number): Tab => ({ id: `t${++seq}`, n, born: Date.now(), dead: false });

export function TerminalPanel({
  root, dark, t, onSendToChat, onClose, onError, full, onToggleFull, expose, exposeRun,
}: Props) {
  const [tabs, setTabs] = useState<Tab[]>(() => [newTab(1)]);
  const [active, setActive] = useState<string>(() => tabs[0].id);
  const handles = useRef(new Map<string, TermHandle>());
  // `active` changes and `expose` is an inline arrow from the parent, so both
  // go through refs: the getter reads the current tab at call time, and the
  // effect runs once instead of on every render.
  const live = useRef({ active: '', expose, exposeRun });
  live.current = { active, expose, exposeRun };

  /** Command panes still waiting to finish, by tab id. */
  const runs = useRef(new Map<string, {
    buffer: string[];
    settle: (r: CommandResult) => void;
  }>());

  useEffect(() => {
    live.current.expose(() => handles.current.get(live.current.active)?.text(200) ?? '');
    live.current.exposeRun((command) => new Promise<CommandResult>((settle) => {
      const next = newTab(Math.max(0, ...tabsRef.current.map((x) => x.n)) + 1);
      next.command = command;
      runs.current.set(next.id, { buffer: [], settle });
      setTabs((p) => [...p, next]);
      setActive(next.id);
    }));
    return () => { live.current.expose(null); live.current.exposeRun(null); };
  }, []);

  // The promise above is created outside React's render, so it needs the tab
  // list as it is *now* rather than as it was when the effect ran.
  const tabsRef = useRef<Tab[]>([]);
  tabsRef.current = tabs;

  function add() {
    const next = newTab(Math.max(0, ...tabs.map((x) => x.n)) + 1);
    setTabs((p) => [...p, next]);
    setActive(next.id);
  }

  function close(id: string) {
    handles.current.delete(id);
    // Closing a pane mid-command still has to answer the agent, or the loop
    // waits for a promise nothing will ever settle.
    const run = runs.current.get(id);
    if (run) {
      runs.current.delete(id);
      const { text, truncated } = readable(run.buffer.join(''));
      run.settle({ code: null, output: text, truncated });
    }
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
  /**
   * A command pane finishing is the answer the agent is waiting for.
   *
   * The pane is left open on purpose. The output is the point, and closing it
   * the instant the command ended would take away the thing the user chose this
   * button to see.
   */
  function finished(tab: Tab, code: number | null) {
    const run = runs.current.get(tab.id);
    if (!run) return false;
    runs.current.delete(tab.id);
    const { text, truncated } = readable(run.buffer.join(''));
    run.settle({ code, output: text, truncated });
    setTabs((p) => p.map((x) => (x.id === tab.id ? { ...x, dead: true } : x)));
    return true;
  }

  function exited(tab: Tab, code: number | null) {
    if (finished(tab, code)) return;
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
                <span className="ptab-i"><Icon name="terminal" size={13} /></span>
                {tab.command ? tab.command.slice(0, 28) : `${t('Terminal')} ${tab.n}`}
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
            command={tab.command}
            onExit={(code) => exited(tab, code)}
            onData={tab.command ? (chunk) => runs.current.get(tab.id)?.buffer.push(chunk) : undefined}
            onError={onError}
          />
        ))}
      </div>
    </section>
  );
}

export default TerminalPanel;
