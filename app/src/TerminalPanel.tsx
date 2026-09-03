import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { TerminalView, type TermHandle } from './TerminalView';
import { readable } from './ansi';
import { Icon } from './Icon';
import * as ask from './ask';
import { filter, shorten, since, stateOf, titleOf } from './terminals';
import { MAX_PANES, focused, only, prune, toggle as togglePane } from './panes';
import { CONTEXT_LINES } from './command';
import { fragment } from './suggest';
import { MIN as MIN_SHARE, after as afterDrag, evened, shares, type Weights } from './split';
import {
  NOTHING as NO_INPUT, keystrokes, kindOf, quotePath, remember, suggest,
  typedPart, worth, type Suggestion, type Typed,
} from './suggest';
import { ContextMenu } from './ContextMenu';
import type { Item as MenuItem, Point as MenuPoint } from './menu';
import { tagClass, tagOf, type Tag } from './tags';
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
  /**
   * Ask for a command in words.
   *
   * Returns a note to show when the answer was not a command; `null` when it
   * was, because a command is handed straight to the approval gate and this
   * panel never sees it. Keeping the command out of here is the point: there
   * is one gate, and it is not in the terminal.
   */
  onAsk?: (question: string, output: string) => Promise<string | null>;
  /**
   * Hands out the panel's claim on an OS drop.
   *
   * Called with a point and the paths, or with `null` paths to ask whether it
   * *would* claim that point. Returns true when the drop is the terminal's.
   */
  exposeDrop?: (claim: ((at: { x: number; y: number }, paths: string[] | null) => boolean) | null) => void;
  /** The user's home directory, so a path can be written the way a prompt does. */
  home?: string;
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
  onSessions, exposeFocus, onAsk, exposeDrop, home = '',
}: Props) {
  /** The ask box: open, what is typed in it, whether a request is in flight. */
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState('');
  const [thinking, setThinking] = useState(false);
  const [note, setNote] = useState('');
  /** Where each shell is, by tab id. Asked after a command, never polled. */
  const [cwds, setCwds] = useState<Record<string, string>>({});
  /** The session row a menu is open on. */
  const [rowMenu, setRowMenu] = useState<{ id: string; at: MenuPoint } | null>(null);
  /**
   * How wide each pane is, by pane id.
   *
   * Shares rather than pixels, so the arrangement survives the window being
   * resized and the panel being made full screen. Keyed by id rather than by
   * position, so hiding a pane and showing it again finds the width it had.
   */
  /**
   * What is half-typed in the focused pane, and what could finish it.
   *
   * Only the focused pane: a suggestion list under a terminal nobody is typing
   * in is a list about a line that is not moving.
   */
  const [input, setInput] = useState<Typed>(NO_INPUT);
  const [matches, setMatches] = useState<Suggestion[]>([]);
  /**
   * Commands run in this terminal, oldest first.
   *
   * Session-only and in memory. A shell has its own history file and this is
   * not it — writing to `~/.zsh_history` from here would be an app editing a
   * file the shell owns and rewrites on exit.
   */
  const [history, setHistory] = useState<string[]>([]);
  const [pickAt, setPickAt] = useState(0);
  /** Every program on PATH. Read once — PATH does not change while we run. */
  const programs = useRef<string[] | null>(null);

  const [weights, setWeights] = useState<Weights>({});
  /** The row being dragged in, measured once when the drag starts. */
  const row = useRef<HTMLDivElement>(null);
  /** Each drawn pane's element, so a drop can be matched to the one under it. */
  const boxes = useRef(new Map<string, HTMLElement>());

  /** Ask one pane where its shell is now. */
  const locate = useCallback((id: string) => {
    void handles.current.get(id)?.cwd().then((where) => {
      if (where) setCwds((p) => (p[id] === where ? p : { ...p, [id]: where }));
    });
  }, []);
  const [tabs, setTabs] = useState<Tab[]>(() => [newTab(1)]);
  const [active, setActive] = useState<string>(() => tabs[0].id);
  /**
   * The panes drawn at once. Every session is mounted whichever of them are
   * showing — that has always been true, because a terminal is a place you
   * leave a server running — so this is only about what is on screen.
   */
  const [shown, setShown] = useState<string[]>(() => [tabs[0].id]);
  const [query, setQuery] = useState('');
  // One row shows its colours at a time; two open pickers in a 236px column
  // is two rows of swatches nobody can tell apart.

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
    live.current.exposeFocus((id) => {
      if (!tabsRef.current.some((x) => x.id === id)) return;
      setActive(id);
      // Focusing a pane that is not drawn would do nothing anybody could see.
      // An id already on screen keeps the split it is part of.
      setShown((p) => (p.includes(id) ? p : only(id)));
    });
    return () => live.current.exposeFocus(null);
  }, []);

  function add(beside = false) {
    const next = newTab(Math.max(0, ...tabs.map((x) => x.n)) + 1);
    setTabs((p) => [...p, next]);
    setActive(next.id);
    // A plain new terminal takes the panel, as it always has. One asked for by
    // Split joins what is already there — that is the whole point of pressing it.
    setShown((p) => (beside ? togglePane(p, next.id, [...tabs.map((x) => x.id), next.id]) : only(next.id)));
  }

  /**
   * Show a second pane beside the one in focus.
   *
   * With another session to hand it uses that one; with only one it opens a new
   * terminal, because a Split button that does nothing when you have a single
   * terminal is a Split button you press once and never trust again.
   */
  /**
   * Send the question, with what is on the terminal for context.
   *
   * A command never comes back here. `onAsk` hands it to the same approval
   * dialog `run_command` uses, so there is one gate and this panel is not part
   * of it — the only thing that returns is a note, which is not runnable.
   */
  async function askNow() {
    const q = question.trim();
    if (!q || !onAsk || thinking) return;
    setThinking(true);
    setNote('');
    try {
      const said = await onAsk(q, handles.current.get(focus)?.text(CONTEXT_LINES) ?? '');
      if (said) setNote(said);
      else { setQuestion(''); setAsking(false); }
    } catch (e) {
      setNote(e instanceof Error ? e.message : String(e));
    } finally {
      setThinking(false);
    }
  }

  /**
   * Drag one divider.
   *
   * Pointer capture, so the drag survives the pointer leaving the divider —
   * which it does immediately, because the divider is six pixels wide and the
   * hand does not stop there. Without it a drag ends the moment it starts
   * working.
   *
   * The delta is measured against the row's width so it is a share, and against
   * the width at the *start* of the drag rather than each frame: re-measuring a
   * box that the drag is changing is how a divider accelerates away from the
   * pointer.
   */
  function startDrag(e: React.PointerEvent, at: number) {
    const box = row.current?.getBoundingClientRect();
    if (!box || box.width <= 0) return;
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    let last = e.clientX;
    document.body.classList.add('resizing');

    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - last;
      if (!dx) return;
      last = ev.clientX;
      // Right-to-left rows put the earlier pane on the right, so a rightward
      // drag has to narrow it rather than widen it.
      const sign = getComputedStyle(el).direction === 'rtl' ? -1 : 1;
      setWeights((w) => afterDrag(onScreen, w, at, (dx * sign) / box.width, MIN_SHARE));
    };
    const done = () => {
      el.releasePointerCapture?.(e.pointerId);
      document.body.classList.remove('resizing');
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', done);
      el.removeEventListener('pointercancel', done);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', done);
    el.addEventListener('pointercancel', done);
  }

  /**
   * Whether a drop at this point belongs to a terminal pane, and taking it.
   *
   * Registered once through a ref on the App side, so this reads the panes'
   * boxes at drop time rather than closing over the ones that existed when the
   * listener was set up.
   */
  const claimDrop = useCallback((at: { x: number; y: number }, paths: string[] | null) => {
    for (const [id, el] of boxes.current) {
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) continue;
      if (at.x < r.left || at.x > r.right || at.y < r.top || at.y > r.bottom) continue;
      // `null` paths is the overlay asking whether this point is ours.
      if (paths) dropPaths(id, paths);
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    exposeDrop?.(claimDrop);
    return () => exposeDrop?.(null);
  }, [exposeDrop, claimDrop]);

  function split() {
    const other = tabs.find((x) => !onScreen.includes(x.id));
    if (!other) return add(true);
    setShown(togglePane(onScreen, other.id, tabs.map((x) => x.id)));
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
    const text = handles.current.get(focus)?.text(200) ?? '';
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

  const rows = filter(tabs, query, t('Terminal'));
  // Pruned on every render rather than in an effect: a session can close from
  // the shell exiting, which is not a click and not a state change this
  // component started, and a pane pointing at it would draw nothing.
  const onScreen = prune(shown, tabs.map((x) => x.id));
  // Every bar action applies to one pane, and it has to be one that is showing.
  const focus = focused(onScreen, active);
  const dead = tabs.find((x) => x.id === focus)?.dead;

  /**
   * Work out what could finish the line, whenever it changes.
   *
   * Debounced, because this runs on every keystroke and the path half reads a
   * directory. Cleared the moment the tracker is unsure — see suggest.ts: a
   * list that is sometimes about a different command is one somebody presses
   * Tab on.
   */
  useEffect(() => {
    if (!input.sure || !input.line.trim()) { setMatches([]); return; }
    let off = false;
    const id = window.setTimeout(() => {
      const done = (words: string[]) => {
        if (off) return;
        setMatches(suggest(input.line, {
          history,
          commands: kindOf(input.line) === 'command' ? words : [],
          paths: kindOf(input.line) === 'command' ? [] : words,
        }));
        setPickAt(0);
      };
      if (kindOf(input.line) === 'command') {
        if (programs.current) { done(programs.current); return; }
        void invoke<string[]>('shell_commands')
          .then((list: string[]) => { programs.current = list; done(list); })
          .catch(() => done([]));
      } else {
        void invoke<string[]>('complete_path', { cwd: cwds[focus] || root, fragment: fragment(input.line) })
          .then(done)
          .catch(() => done([]));
      }
    }, 90);
    return () => { off = true; window.clearTimeout(id); };
  }, [input, focus, root, cwds, history]);

  /**
   * Take the chosen completion.
   *
   * The keystrokes go to the pty as if they had been typed, because that is
   * what they are: a filename off the disk or a program on PATH, chosen by a
   * person pressing a key. Nothing a model wrote is anywhere near this, and the
   * line still has to be sent by hand — this fills in a word, it does not run
   * anything.
   */
  function take(choice: Suggestion) {
    const h = handles.current.get(focus);
    if (!h) return;
    h.type(keystrokes(input, choice));
    setMatches([]);
  }

  /**
   * Files dropped on a pane become their paths at the prompt, quoted.
   *
   * What every terminal does with a drop, and what the window would otherwise
   * do instead — attach them to the chat, which is right everywhere except
   * over a shell.
   */
  function dropPaths(id: string, paths: string[]) {
    const h = handles.current.get(id);
    if (!h || !paths.length) return;
    setActive(id);
    h.type(`${paths.map(quotePath).join(' ')} `);
  }

  // Assigned here rather than beside the ref because it carries `focus`, which
  // is only known once the visible set is. Effects run after the whole render,
  // so nothing reads it before this line.
  live.current = { active: focus, expose, exposeRun, exposeFocus };

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
          <button className="ghost" onClick={() => handles.current.get(focus)?.clear()} disabled={dead}>
            {t('Clear')}
          </button>
          {onAsk && (
            <button className={`ghost tsk-open ${asking ? 'on' : ''}`}
                    onClick={() => { setAsking((v) => !v); setNote(''); }}
                    aria-expanded={asking}
                    title={t('Describe what you want and get a command')}>
              <Icon name="sparkle" size={13} />{t('Ask')}
            </button>
          )}
          <button className="ghost icon" onClick={split}
                  disabled={onScreen.length >= MAX_PANES}
                  title={t('Show another terminal beside this one')}
                  aria-label={t('Show another terminal beside this one')}>
            <Icon name="split" size={14} />
          </button>
          <button className="ghost icon" onClick={onToggleFull} aria-pressed={full}
                  title={t(full ? 'Restore the panel' : 'Fill the window')}
                  aria-label={t(full ? 'Restore the panel' : 'Fill the window')}><Icon name={full ? 'restore' : 'maximise'} size={14} /></button>
          <button className="ghost icon" onClick={() => onClose()} title={t('Hide the panel')} aria-label={t('Hide the panel')}><Icon name="chevron" size={14} turn={90} /></button>
        </div>
      </div>

      {asking && onAsk && (
        <div className="tsk">
          <form className="tsk-row" onSubmit={(e) => { e.preventDefault(); void askNow(); }}>
            <Icon name="sparkle" size={13} />
            <input value={question} onChange={(e) => setQuestion(e.target.value)}
                   /* Autofocus is right here and almost nowhere else: the box
                      appeared because somebody pressed the button that opens
                      it, so it is the only thing they can have meant. */
                   autoFocus
                   onKeyDown={(e) => { if (e.key === 'Escape') { setAsking(false); setNote(''); } }}
                   placeholder={t('What do you want to do?')}
                   aria-label={t('What do you want to do?')}
                   disabled={thinking} spellCheck={false} />
            <button className="approve" type="submit" disabled={thinking || !question.trim()}>
              {thinking ? t('Thinking') : t('Ask')}
            </button>
          </form>
          {/* Never runnable, and it does not look runnable. A note is what
              comes back when the request had no answer as a command. */}
          {note && <p className="tsk-note">{note}</p>}
          <p className="tsk-why">{t('The command is shown for you to approve before anything runs.')}</p>
        </div>
      )}

      {rowMenu && (() => {
        const tab = tabs.find((x) => x.id === rowMenu.id);
        if (!tab) return null;
        const on = onScreen.includes(tab.id);
        const items: MenuItem[] = [
          { kind: 'action', id: 'split', label: on ? 'Hide this pane' : 'Show this alongside',
            disabled: !on && onScreen.length >= MAX_PANES },
          { kind: 'action', id: 'rename', label: 'Rename this terminal' },
          { kind: 'divider' },
          { kind: 'swatches' },
          { kind: 'divider' },
          { kind: 'action', id: 'copy', label: 'Copy the path' },
          { kind: 'action', id: 'clear', label: 'Clear' },
          { kind: 'divider' },
          { kind: 'action', id: 'close', label: 'Close', danger: true },
        ];
        return (
          <ContextMenu at={rowMenu.at} items={items} t={t}
            label={`${t('Actions')} — ${titleOf(tab, t('Terminal')).text}`}
            tag={tagOf(tab.tag)}
            onTag={(tag: Tag) => setTabs((p) => p.map((x) => (x.id === tab.id ? { ...x, tag } : x)))}
            onClose={() => setRowMenu(null)}
            onPick={(id) => {
              if (id === 'split') { setActive(tab.id); setShown(togglePane(onScreen, tab.id, tabs.map((x) => x.id))); }
              else if (id === 'rename') rename(tab);
              else if (id === 'clear') handles.current.get(tab.id)?.clear();
              else if (id === 'close') close(tab.id);
              else if (id === 'copy') {
                void navigator.clipboard.writeText(cwds[tab.id] || root).catch(() => {});
              }
            }} />
        );
      })()}

      <div className="panel-split">
        <div className="tsl" role="navigation" aria-label={t('Terminal sessions')}>
          <div className="tsl-head">
            <span className="tsl-find">
              <Icon name="search" size={13} />
              <input value={query} onChange={(e) => setQuery(e.target.value)}
                     placeholder={t('Search sessions…')} aria-label={t('Search sessions…')}
                     spellCheck={false} />
            </span>
            <button className="tsl-add" onClick={() => add()}
                    title={t('New terminal')} aria-label={t('New terminal')}>
              <Icon name="plus" size={15} />
            </button>
          </div>

          <div {...drag.strip} className={`tsl-list ${drag.strip.className}`}>
            {/* Two different states, and saying the second when the first is
                true tells somebody their search failed when they never made
                one. `Chats.tsx` already draws this distinction. */}
            {rows.length === 0 && (
              <p className="tsl-none">
                {query.trim() ? t('No session matches that.') : t('No terminals open.')}
              </p>
            )}
            {rows.map((tab, i) => {
              const state = stateOf(tab);
              const title = titleOf(tab, t('Terminal'));
              return (
                <div key={tab.id} className={`tsl-row ${tagClass(tab.tag)} ${drag.itemClass(i)} ${onScreen.includes(tab.id) ? 'on' : ''}`}
                     onContextMenu={(e) => {
                       e.preventDefault();
                       setRowMenu({ id: tab.id, at: { x: e.clientX, y: e.clientY } });
                     }}>
                  {/* Clicking a row means "show me this one", as it always has.
                      Showing it *as well* is the button below, so the ordinary
                      click never has to be learnt twice. */}
                  <button className="tsl-pick"
                          onClick={() => { setActive(tab.id); setShown(only(tab.id)); }}
                          aria-current={tab.id === focus ? 'true' : undefined}>
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
                  {/* One button, not four. The row carried a split toggle, a
                      rename, a colour and a close, and four targets in a
                      28px-tall row is four things to miss. Everything but the
                      split lives in the menu now — which is also where people
                      look for it. */}
                  <button className={`tsl-x ${onScreen.includes(tab.id) ? 'lit' : ''}`} data-nodrag
                          onClick={() => { setActive(tab.id); setShown(togglePane(onScreen, tab.id, tabs.map((x) => x.id))); }}
                          aria-pressed={onScreen.includes(tab.id)}
                          disabled={!onScreen.includes(tab.id) && onScreen.length >= MAX_PANES}
                          title={onScreen.includes(tab.id) ? t('Hide this pane') : t('Show this alongside')}
                          aria-label={onScreen.includes(tab.id) ? t('Hide this pane') : t('Show this alongside')}>
                    <Icon name="split" size={12} />
                  </button>
                  <button className="tsl-x" data-nodrag
                          onClick={(e) => {
                            const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                            setRowMenu({ id: tab.id, at: { x: r.left, y: r.bottom + 4 } });
                          }}
                          title={t('More')} aria-label={`${t('More')} — ${title.text}`}>
                    <Icon name="ellipsis" size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

      <div ref={row} className={`panel-body ${onScreen.length > 1 ? 'split' : ''}`}>
        {tabs.map((tab) => {
          const on = onScreen.includes(tab.id);
          const title = titleOf(tab, t('Terminal'));
          // Where this pane sits among the ones actually drawn. The divider
          // belongs *before* it, and the first visible pane has none.
          const at = onScreen.indexOf(tab.id);
          const width = at >= 0 ? shares(onScreen, weights)[at] : 0;
          return (
            /* Every pane stays mounted whether or not it is drawn — a terminal
               is a place you leave a server running, so this is display, never
               unmount. */
            <Fragment key={tab.id}>
            {/* Rendered per pane rather than interleaved, because every pane
                stays mounted and a hidden one must not leave a divider behind.
                Hidden itself when its pane is, and when its pane is first. */}
            <div className="tdiv" role="separator" aria-orientation="vertical"
                 tabIndex={at > 0 ? 0 : -1}
                 aria-label={`${t('Resize')} — ${title.text}`}
                 style={{ display: on && at > 0 ? 'block' : 'none' }}
                 onPointerDown={(e) => startDrag(e, at)}
                 onKeyDown={(e) => {
                   // The keyboard moves it too. A divider only the mouse can
                   // reach is a size only some people can set.
                   const by = e.key === 'ArrowLeft' ? -0.02 : e.key === 'ArrowRight' ? 0.02 : 0;
                   if (!by) return;
                   e.preventDefault();
                   setWeights((w) => afterDrag(onScreen, w, at, by));
                 }}
                 onDoubleClick={() => setWeights((w) => evened(onScreen, w))}
                 title={t('Drag to resize, double-click to even them out')} />

            <div className={`tpane ${tagClass(tab.tag)} ${on && tab.id === focus ? 'on' : ''}`}
                 ref={(el) => {
                   // Only drawn panes are droppable; a hidden one has no box.
                   if (el && on) boxes.current.set(tab.id, el);
                   else boxes.current.delete(tab.id);
                 }}
                 style={{ display: on ? 'flex' : 'none', flexGrow: width * onScreen.length }}
                 onMouseDown={() => setActive(tab.id)}>
              {/* Side by side, two panes are two anonymous dark rectangles
                  without a name on them. One pane needs no label: the row it
                  came from is already lit in the list beside it. */}
              {onScreen.length > 1 && (
                <div className="tpane-head">
                  <span className={`tpane-name ${title.mono ? 'mono' : ''}`}
                        title={title.text}>{title.text}</span>
                  <button className="tsl-x"
                          onClick={() => setShown(togglePane(onScreen, tab.id, tabs.map((x) => x.id)))}
                          title={t('Hide this pane')} aria-label={`${t('Hide this pane')} — ${title.text}`}>
                    <Icon name="close" size={11} />
                  </button>
                </div>
              )}
              <TerminalView
                onMoved={() => locate(tab.id)}
                onTyped={(st) => { if (tab.id === focus) setInput(st); }}
                // A line goes into history when it is sent, and only from the
                // tracker — which means only lines this app is sure it saw
                // whole. A recalled or tab-completed line is not remembered
                // twice-wrong; it is not remembered at all.
                onSent={(line) => setHistory((h) => remember(h, line))}
                onDropPaths={(paths) => dropPaths(tab.id, paths)}
                onKey={(e) => {
                  // Only while a list is showing, and only for this pane.
                  if (tab.id !== focus || !worth(input, matches)) return false;
                  if (e.key === 'Escape') { setMatches([]); return true; }
                  if (e.key === 'ArrowDown') { setPickAt((n) => (n + 1) % matches.length); return true; }
                  if (e.key === 'ArrowUp') { setPickAt((n) => (n - 1 + matches.length) % matches.length); return true; }
                  // Tab takes the choice. The shell's own completion is what
                  // this is standing in for, so taking the key here is the
                  // whole point — and pressing it with no list showing falls
                  // through to the shell as it always did.
                  if (e.key === 'Tab') { take(matches[pickAt] ?? matches[0]); return true; }
                  return false;
                }}
                cwd={root}
                dark={dark}
                visible={on}
                onReady={(h) => { if (h) handles.current.set(tab.id, h); else handles.current.delete(tab.id); }}
                command={tab.command}
                onExit={(code) => exited(tab, code)}
                onData={tab.command ? (chunk) => runs.current.get(tab.id)?.buffer.push(chunk) : undefined}
                onError={onError}
              />

              {/* What could finish the line.
                  Docked at the foot of the pane rather than floated at the
                  cursor: a prompt sits at the bottom of a terminal almost all
                  the time, because output scrolls up — so this is where the
                  cursor is, without measuring a character cell to find out. */}
              {tab.id === focus && worth(input, matches) && (
                <div className="sug" role="listbox" aria-label={t('Completions')}>
                  {matches.map((m, n) => (
                    <button key={`${m.kind}:${m.text}`} role="option" aria-selected={n === pickAt}
                            className={`sug-row ${n === pickAt ? 'on' : ''} ${m.kind} ${m.text.endsWith('/') ? 'dir' : ''}`}
                            onMouseEnter={() => setPickAt(n)}
                            onClick={() => take(m)}>
                      {/* A clock for a line you ran before, so the one thing
                          that replaces the whole line looks different from the
                          ones that finish a word. */}
                      <Icon name={m.kind === 'history' ? 'clock' : m.kind === 'command' ? 'terminal'
                        : m.text.endsWith('/') ? 'folder' : 'file'} size={11} />
                      <span>
                        <b>{m.text.slice(0, typedPart(input.line, m))}</b>
                        {m.text.slice(typedPart(input.line, m))}
                      </span>
                    </button>
                  ))}
                  <span className="sug-hint">{t('Tab to take it')}</span>
                </div>
              )}

              {/* Where the shell is, under the prompt rather than in the
                  title: it is the answer to "where am I", and that question is
                  asked while looking at the last line of output, not at the
                  top of the pane.

                  The folder the terminal started in is the fallback, which is
                  right until somebody types `cd` — and on Windows, where a
                  process's directory cannot be read cheaply, it is all there
                  is. Better a path that is usually right and labelled as the
                  project than a blank strip. */}
              <div className="tfoot">
                <Icon name="folder" size={11} />
                <span className="tfoot-path" title={cwds[tab.id] || root}>
                  {shorten(cwds[tab.id] || root, home)}
                </span>
                <span className={`tfoot-dot ${stateOf(tab)}`} aria-hidden="true" />
                <span className="tfoot-state">
                  {stateOf(tab) === 'busy' ? t('running')
                    : stateOf(tab) === 'live' ? t('shell')
                    : stateOf(tab) === 'ok' ? t('finished')
                    : tab.code === null ? t('stopped') : `${t('exit')} ${tab.code}`}
                </span>
                <button className="tfoot-copy" data-nodrag
                        onClick={() => void navigator.clipboard.writeText(cwds[tab.id] || root).catch(() => {})}
                        title={t('Copy the path')} aria-label={t('Copy the path')}>
                  <Icon name="clipboard" size={11} />
                </button>
              </div>
            </div>
            </Fragment>
          );
        })}
      </div>
      </div>
    </section>
  );
}

export default TerminalPanel;
