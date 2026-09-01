import { useEffect, useRef, useState } from 'react';
import { TerminalView, type TermHandle } from './TerminalView';
import { readable } from './ansi';
import { Icon } from './Icon';
import * as ask from './ask';
import { filter, since, stateOf, titleOf } from './terminals';
import { TagPicker } from './TagPicker';
import { tagClass, type Tag } from './tags';
import { move } from './reorder';
import { useReorder } from './useReorder';

/**
 * The terminal panel: sessions down the left, shells to the right.
 *
 * The strip of tabs across the top worked for two panes and stopped working at
 * five. Names truncated to "Termi…", a command pane's whole identity is the
 * command it is running and there was nowhere to put it, and nothing said
 * whether a pane was still going. A vertical list has room for a second line
 * and for a state on every row.
 *
 * Every pane stays mounted while its row is not selected. A terminal is a place
 * you leave a server running and come back to, so unmounting on switch would
 * throw away both the scrollback and the process.
 */

interface Tab {
  id: string; n: number; born: number; dead: boolean;
  /** Set when this pane exists to run one approved command. */
  command?: string;
  /**
   * A colour, by name. In memory only, and deliberately so: a terminal session
   * is a running shell and does not outlive the app either, so persisting a
   * colour would be keeping a label for a process that has gone.
   */
  tag?: string;
  /** The exit code once there is one. `null` means a signal, which is not a
   *  clean finish — the row shows that difference. */
  code?: number | null;
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
  /** Reports the pane list upward, so one search field can find a session. */
  onSessions: (tabs: Tab[]) => void;
  /** Hands the palette a way to focus a pane it found. */
  exposeFocus: (focus: ((id: string) => void) | null) => void;
  onError: (message: string) => void;
}

let seq = 0;
const newTab = (n: number): Tab => ({ id: `t${++seq}`, n, born: Date.now(), dead: false });

export function TerminalPanel({
  root, dark, t, onSendToChat, onClose, onError, full, onToggleFull, expose, exposeRun,
  onSessions, exposeFocus,
}: Props) {
  const [tabs, setTabs] = useState<Tab[]>(() => [newTab(1)]);
  const [active, setActive] = useState<string>(() => tabs[0].id);
  const [query, setQuery] = useState('');
  // One row shows its colours at a time; two open pickers in a 236px column
  // is two rows of swatches nobody can tell apart.
  const [colouring, setColouring] = useState<string | null>(null);

  /**
   * Rename a pane.
   *
   * `window.prompt`, exactly as the chat list does it — the rail is a 236px
   * column with no room for an inline field, and a modal that cannot be
   * mistyped past is the right shape for something that replaces a label.
   * Blank restores the default rather than leaving a nameless row.
   */
  async function rename(tab: Tab) {
    const typed = await ask.text({ title: t('Rename this terminal'),
                                  value: titleOf(tab, t('Terminal')).text });
    if (typed === null) return;
    const name = typed.trim();
    setTabs((p) => p.map((x) => (x.id === tab.id ? { ...x, name: name || undefined } : x)));
  }
  // Ticks once a minute so the ages on the rows stay honest without a timer per
  // row. A terminal you opened an hour ago should not still say 1m.
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setClock(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const handles = useRef(new Map<string, TermHandle>());
  // `active` changes and `expose` is an inline arrow from the parent, so both
  // go through refs: the getter reads the current tab at call time, and the
  // effect runs once instead of on every render.
  const live = useRef({ active: '', expose, exposeRun, exposeFocus });
  live.current = { active, expose, exposeRun, exposeFocus };

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

  // The pane list, upward, so the one search field can find a session by the
  // command it is running. A copy, not the array: the palette must not be able
  // to hold a reference this component then mutates under it.
  const report = useRef(onSessions);
  report.current = onSessions;
  useEffect(() => { report.current([...tabs]); }, [tabs]);

  useEffect(() => {
    live.current.exposeFocus((id) => { if (tabsRef.current.some((x) => x.id === id)) setActive(id); });
    return () => live.current.exposeFocus(null);
  }, []);

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
    setTabs((p) => p.map((x) => (x.id === tab.id ? { ...x, dead: true, code } : x)));
    return true;
  }

  function exited(tab: Tab, code: number | null) {
    if (finished(tab, code)) return;
    if (Date.now() - tab.born < 800) {
      setTabs((p) => p.map((x) => (x.id === tab.id ? { ...x, dead: true, code } : x)));
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

  /**
   * Dragging a session to a different place in the list.
   *
   * Off while the search box has something in it. The rows on screen are then a
   * subset of the list, and a drop between two of them is a promise about a
   * position that is not on screen.
   */
  const drag = useReorder({
    axis: 'y',
    enabled: !query.trim(),
    onMove: (from, to) => setTabs((p) => move(p, from, to)),
  });

  const dead = tabs.find((x) => x.id === active)?.dead;
  const shown = filter(tabs, query, t('Terminal'));

  return (
    <section className="panel" aria-label={t('Terminal')}>
      <div className="panel-bar">
        <div className="panel-title">
          <Icon name="terminal" size={13} />
          {t('Terminal')}
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

      <div className="panel-split">
        <div className="tsl" role="navigation" aria-label={t('Terminal sessions')}>
          <div className="tsl-head">
            <span className="tsl-find">
              <Icon name="search" size={13} />
              <input value={query} onChange={(e) => setQuery(e.target.value)}
                     placeholder={t('Search sessions…')} aria-label={t('Search sessions…')}
                     spellCheck={false} />
            </span>
            <button className="tsl-add" onClick={add}
                    title={t('New terminal')} aria-label={t('New terminal')}>
              <Icon name="plus" size={15} />
            </button>
          </div>

          <div {...drag.strip} className={`tsl-list ${drag.strip.className}`}>
            {/* Two different states, and saying the second when the first is
                true tells somebody their search failed when they never made
                one. `Chats.tsx` already draws this distinction. */}
            {shown.length === 0 && (
              <p className="tsl-none">
                {query.trim() ? t('No session matches that.') : t('No terminals open.')}
              </p>
            )}
            {shown.map((tab, i) => {
              const state = stateOf(tab);
              const title = titleOf(tab, t('Terminal'));
              return (
                <div key={tab.id} className={`tsl-row ${tagClass(tab.tag)} ${drag.itemClass(i)} ${tab.id === active ? 'on' : ''}`}>
                  <button className="tsl-pick" onClick={() => setActive(tab.id)}
                          aria-current={tab.id === active ? 'true' : undefined}>
                    <span className={`tsl-mark ${state}`}>
                      <Icon name="terminal" size={14} />
                      {/* The badge carries the state, so the second line is free
                          to say something the badge cannot. */}
                      <i className="tsl-dot" aria-hidden="true">
                        {state === 'ok' && <Icon name="check" size={9} />}
                        {state === 'failed' && <Icon name="warning" size={9} />}
                      </i>
                    </span>
                    <span className="tsl-text">
                      <span className={`tsl-name ${title.mono ? 'mono' : ''}`}
                            title={title.text}>{title.text}</span>
                      <span className="tsl-sub">
                        {state === 'busy' ? t('running')
                          : state === 'live' ? t('shell')
                          : state === 'ok' ? t('finished')
                          : tab.code === null ? t('stopped') : `${t('exit')} ${tab.code}`}
                        <span className="tsl-age">{since(tab.born, clock, t)}</span>
                      </span>
                    </span>
                  </button>
                  <button className="tsl-x" data-nodrag onClick={() => rename(tab)}
                          title={t('Rename this terminal')} aria-label={t('Rename this terminal')}>
                    <Icon name="pencil" size={12} />
                  </button>
                  <button className="tsl-x" data-nodrag
                          onClick={() => setColouring(colouring === tab.id ? null : tab.id)}
                          title={t('Colour')} aria-label={t('Colour')}
                          aria-expanded={colouring === tab.id}>
                    <Icon name="dot" size={13} />
                  </button>
                  <button className="tsl-x" onClick={() => close(tab.id)} data-nodrag
                          title={t('Close')}
                          aria-label={`${t('Close')} ${title.text}`}><Icon name="close" size={12} /></button>
                  {colouring === tab.id && (
                    <TagPicker value={tab.tag} t={t}
                               onPick={(tag: Tag) => {
                                 setTabs((p) => p.map((x) => (x.id === tab.id ? { ...x, tag } : x)));
                                 setColouring(null);
                               }} />
                  )}
                </div>
              );
            })}
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
      </div>
    </section>
  );
}

export default TerminalPanel;
