import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { TerminalView, type TermHandle } from './TerminalView';
import { readable } from './ansi';
import { Icon } from './Icon';
import {
  ROW_VIEW_KEY, filter, readView, rowOf, shorten, stateOf, titleOf, writeView,
  type Facts, type RowView,
} from './terminals';
import { MAX_PANES, focused, only, prune, swap as swapPane, toggle as togglePane } from './panes';
import { CONTEXT_LINES } from './command';
import {
  KEY as TERMS_KEY, read as readSaved, tail, write as writeSaved, type Saved,
} from './scrollback';
import { fill } from './i18n';
import { fragment } from './suggest';
import {
  DRAG_PANE, DRAG_PATH, describe as describeFile, head as pasteHead, isBulk, pastedFile,
  pathForPrompt, size as pasteSize, summarise as pasteInfo, under, worthHolding,
  type PastedFile,
} from './paste';
import { MIN as MIN_SHARE, after as afterDrag, evened, shares, type Weights } from './split';
import { PRESETS, apply as applyPreset, describe as describeLayout, type Preset } from './layouts';
import {
  NOTHING as NO_INPUT, keystrokes, kindOf, preview, quotePath, remember, suggest,
  typedPart, wantsDir, worth, type Suggestion, type Typed,
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
   * A name somebody typed.
   *
   * Was only ever set through a spread, so nothing declared it and nothing
   * checked it — `rename` wrote a field the type did not have and TypeScript
   * had no way to notice until something read it back.
   */
  name?: string;
  /**
   * A colour, by name.
   *
   * This used to say the colour was deliberately not persisted, because "a
   * terminal session is a running shell and does not outlive the app". Half of
   * that is still true and half of it is not: the process still dies with the
   * app, but the *session* — its name, its colour, its directory, what was
   * written in it — is restored now. See scrollback.ts, and the banner that
   * makes the difference visible.
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
   * Commands run in each terminal, oldest first, by pane id.
   *
   * Per pane, not per panel: a command run in one terminal being offered in
   * another is a suggestion about somewhere you are not.
   *
   * Session-only and in memory. A shell has its own history file and this is
   * not it — writing to `~/.zsh_history` from here would be an app editing a
   * file the shell owns and rewrites on exit.
   */
  const [history, setHistory] = useState<Record<string, string[]>>({});
  /** The branch of each pane's directory, empty outside a repository. */
  const [branches, setBranches] = useState<Record<string, string>>({});
  /** How the rows read. */
  const [view, setView] = useState<RowView>(() => readView(localStorage.getItem(ROW_VIEW_KEY)));
  const [tuning, setTuning] = useState(false);
  const [pickAt, setPickAt] = useState(0);

  /**
   * What this person has already run, from their shell's own history file.
   *
   * Read once, because it is a file on disk that only the shell appends to and
   * re-reading it per keystroke would be a syscall for a list that has not
   * changed. Without it the completer knows only what has been typed into this
   * pane since it opened, which makes the useful suggestion always one session
   * too late: `claude --dang` cannot be finished into the line you have run
   * fifty times if the only history is the one you started two minutes ago.
   *
   * Failure is silence. No history file, an unreadable one, an older build of
   * the Rust side without the command — all of them mean the list falls back
   * to this session's own lines, which is where it was before.
   */
  const [shellPast, setShellPast] = useState<string[]>([]);
  useEffect(() => {
    void invoke<string[]>('shell_history').then(setShellPast).catch(() => {});
  }, []);
  /** Every program on PATH. Read once — PATH does not change while we run. */
  const programs = useRef<string[] | null>(null);

  /**
   * The session rail: whether it shows, and how wide it is.
   *
   * Both remembered. The rail is furniture, and furniture that resets on
   * every launch is furniture somebody arranges every morning.
   */
  const [railHidden, setRailHidden] = useState(() => localStorage.getItem('vylo.tslhide') === '1');

  /**
   * Whether the sessions column is on screen.
   *
   * Two reasons it might not be, and they are different in kind: somebody
   * collapsed it, or the layout is tabs and there is a strip across the top
   * doing the same job. The button that collapses it is left alone in tabs —
   * hiding a column that is already gone is a control with nothing to do.
   */
  const listOff = railHidden || view.as === 'tabs';
  const [railW, setRailW] = useState(() => {
    const v = Number(localStorage.getItem('vylo.tslw'));
    return Number.isFinite(v) && v >= 160 ? Math.min(v, 420) : 236;
  });
  useEffect(() => {
    try {
      localStorage.setItem('vylo.tslhide', railHidden ? '1' : '0');
      localStorage.setItem('vylo.tslw', String(railW));
    } catch { /* private mode */ }
  }, [railHidden, railW]);

  /** Drag the line between the rail and the panes. */
  function dragRail(e: React.PointerEvent) {
    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startW = railW;
    const sign = getComputedStyle(el).direction === 'rtl' ? -1 : 1;
    document.body.classList.add('resizing');
    const move = (ev: PointerEvent) => {
      const w = Math.round(startW + (ev.clientX - startX) * sign);
      setRailW(Math.min(Math.max(w, 160), 420));
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

  const [weights, setWeights] = useState<Weights>({});
  /** The row being dragged in, measured once when the drag starts. */
  const row = useRef<HTMLDivElement>(null);
  /** Each drawn pane's element, so a drop can be matched to the one under it. */
  const boxes = useRef(new Map<string, HTMLElement>());

  /** Ask one pane where its shell is now. */
  useEffect(() => {
    try { localStorage.setItem(ROW_VIEW_KEY, writeView(view)); } catch { /* private mode */ }
  }, [view]);

  /**
   * The branch each pane is on.
   *
   * Asked when a pane's directory changes and at no other time — a shell can
   * `cd` anywhere, so the branch is a fact about the pane rather than about
   * the open folder, and it only changes when the directory does. `git_state`
   * runs `git` in a directory the person's own shell is already sitting in.
   */
  useEffect(() => {
    let off = false;
    for (const [id, dir] of Object.entries(cwds)) {
      if (!dir) continue;
      void invoke<{ is_repo: boolean; branch: string }>('git_state', { root: dir })
        .then((g) => {
          if (off) return;
          const branch = g.is_repo ? g.branch : '';
          setBranches((p) => (p[id] === branch ? p : { ...p, [id]: branch }));
        })
        .catch(() => {});
    }
    return () => { off = true; };
  }, [cwds]);

  /** Everything known about one pane, for its row. */
  const factsFor = (id: string): Facts => ({
    cwd: cwds[id],
    branch: branches[id],
    last: (history[id] ?? [])[(history[id] ?? []).length - 1],
  });

  /**
   * Write this folder's terminals down.
   *
   * Read from each pane's buffer at the moment of saving rather than kept in
   * step as output arrives — a terminal produces thousands of lines a second
   * under a build, and mirroring that into React state would spend the whole
   * frame budget on a record nobody is looking at.
   */
  const save = useCallback(() => {
    if (!root) return;
    const list = tabsRef.current;
    const saved: Saved = {
      sessions: list.map((x) => ({
        n: x.n,
        name: x.name,
        tag: x.tag,
        cwd: cwdRef.current[x.id],
        text: tail(handles.current.get(x.id)?.lines() ?? []),
      })),
      shown: shownRef.current.map((id) => list.findIndex((x) => x.id === id)).filter((i) => i >= 0),
      active: Math.max(0, list.findIndex((x) => x.id === activeRef.current)),
    };
    try {
      localStorage.setItem(TERMS_KEY, writeSaved(localStorage.getItem(TERMS_KEY), root, saved));
    } catch { /* private mode, or a full store */ }
  }, [root]);

  useEffect(() => {
    // A heartbeat, and the way out. `beforeunload` is the one that matters and
    // the one least certain to fire — a window torn down by the OS never
    // reaches it — so the timer is what makes the feature true rather than
    // usually true.
    const id = window.setInterval(save, 20_000);
    window.addEventListener('beforeunload', save);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('beforeunload', save);
      save();
    };
  }, [save]);

  const locate = useCallback((id: string) => {
    void handles.current.get(id)?.cwd().then((where) => {
      if (where) setCwds((p) => (p[id] === where ? p : { ...p, [id]: where }));
    });
  }, []);
  /**
   * What was saved for this folder, read once when the panel mounts.
   *
   * The processes are gone — a shell is a child of this app — so this is the
   * sessions, their names, their directories and what was written in them. The
   * banner each restored pane opens with says so; see scrollback.ts.
   */
  const restored = useRef<Saved>(readSaved(localStorage.getItem(TERMS_KEY), root));
  /** Restored text and directory per pane. Read once, when its view opens. */
  const [restoring] = useState(() => new Map<string, { text: string; cwd?: string }>());
  const [tabs, setTabs] = useState<Tab[]>(() => {
    const saved = restored.current.sessions;
    if (!saved.length) return [newTab(1)];
    const made = saved.map((x) => ({ ...newTab(x.n), name: x.name, tag: x.tag }));
    made.forEach((tabRow, i) => {
      restoring.set(tabRow.id, { text: saved[i].text, cwd: saved[i].cwd });
    });
    return made;
  });
  const [active, setActive] = useState<string>(() => tabs[0].id);
  /**
   * The panes drawn at once. Every session is mounted whichever of them are
   * showing — that has always been true, because a terminal is a place you
   * leave a server running — so this is only about what is on screen.
   */
  const [shown, setShown] = useState<string[]>(() => {
    const saved = restored.current;
    if (!saved.sessions.length) return [tabs[0].id];
    return saved.shown.map((i) => tabs[i]?.id).filter((x): x is string => !!x);
  });
  const [query, setQuery] = useState('');
  // One row shows its colours at a time; two open pickers in a 236px column
  // is two rows of swatches nobody can tell apart.

  /**
   * The pane whose name is being typed, if any.
   *
   * Renaming used to open a modal — the reasoning was that a 236px column has
   * no room for a field. It has exactly the room the name already takes, which
   * is the point: the field appears where the name is, holding the name, so
   * what is being changed and what it will look like are the same pixels.
   * A dialog for one short word is three keystrokes and a context switch for
   * something people do while thinking about something else.
   */
  const [renaming, setRenaming] = useState<string | null>(null);
  /** Set by Escape so the blur that follows does not save what was typed. */
  const cancelRename = useRef(false);

  /**
   * Text pasted into a pane and not yet sent to it.
   *
   * Held rather than delivered, because a paste ending in a newline runs — see
   * paste.ts. One at a time and per pane: a second paste while one is waiting
   * replaces it, which is what somebody who pasted the wrong thing does next.
   */
  /**
   * What is waiting to go to a pane, and which kind of thing it is.
   *
   * A union rather than optional fields, because the two are answered
   * differently: text goes in as a paste so the program on the other end gets
   * whatever bracketing it asked for, and files go in as quoted paths.
   */
  type Held =
    | { id: string; kind: 'text'; text: string }
    | { id: string; kind: 'files'; paths: string[]; file: PastedFile; n: number };
  const [held, setHeld] = useState<Held | null>(null);

  /**
   * How many files have been pasted into this panel.
   *
   * Only so a chip can say *which* one — `image #1`, `image #2`. A path is
   * sixty characters of `/var/folders/xy/8dln…` and tells nobody anything at
   * a glance; a number and a filename do. It counts up for the life of the
   * panel and is never read for anything else.
   */
  const pasted = useRef(0);

  /**
   * Which pane the pointer is over during a drag, or null.
   *
   * The drop itself has worked since panes were split; what it never had was
   * anything on screen saying so. A file dragged over a terminal that gives no
   * sign is a file nobody lets go of.
   */
  const [dropOn, setDropOn] = useState<string | null>(null);

  /** The pane being dragged, if one is. Null the rest of the time. */
  const [lifting, setLifting] = useState<string | null>(null);

  /** Start renaming, with the current name in the field to type over. */
  function rename(tab: Tab) {
    setRenaming(tab.id);
  }

  /**
   * Take the typed name, or put the default back.
   *
   * Blank restores the default rather than leaving a nameless row — a row with
   * no label is one nobody can refer to, and "clear it" is a reasonable thing
   * to mean by deleting the text.
   */
  function named(id: string, typed: string) {
    const name = typed.trim();
    setTabs((p) => p.map((x) => (x.id === id ? { ...x, name: name || undefined } : x)));
    setRenaming(null);
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
  // Read by `save`, which runs on a timer and on the way out — both of which
  // happen outside a render, so each needs the value as it is now and not the
  // one that existed when the callback was made.
  const tabsRef = useRef<Tab[]>([]);
  tabsRef.current = tabs;
  // Also read by `onDropOut`, which `useReorder` is handed once and keeps in a
  // ref of its own — so the `onScreen` it closes over is the first one there
  // ever was.
  const shownRef = useRef<string[]>([]);
  const activeRef = useRef('');
  const cwdRef = useRef<Record<string, string>>({});

  // The pane list, upward, so the one search field can find a session by the
  // command it is running. A copy, not the array: the palette must not be able
  // to hold a reference this component then mutates under it.
  const report = useRef(onSessions);
  report.current = onSessions;
  useEffect(() => { report.current([...tabs]); }, [tabs]);

  useEffect(() => {
    live.current.exposeFocus((id) => {
      // After paint, and that is the whole reason this is deferred: a pane
      // that is being shown, or re-laid-out to fill the window, has not been
      // fitted yet, and a caret placed in it beforehand lands in a terminal
      // that is about to change size underneath it.
      const caret = (to: string) => requestAnimationFrame(() => handles.current.get(to)?.focus());
      // No id means "whatever is already active" — what entering the Terminal
      // space needs, which is a caret in the shell without choosing a pane on
      // anybody's behalf.
      if (!id) { caret(live.current.active); return; }
      if (!tabsRef.current.some((x) => x.id === id)) return;
      setActive(id);
      // Focusing a pane that is not drawn would do nothing anybody could see.
      // An id already on screen keeps the split it is part of.
      setShown((p) => (p.includes(id) ? p : only(id)));
      caret(id);
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
      // `null` paths is the overlay asking whether this point is ours, which
      // is also the only moment anything knows a drag is in progress — so it
      // is where the pane is lit. A drag that ends off the window arrives here
      // as a point inside no pane, which clears it.
      if (paths) { dropPaths(id, paths); setDropOn(null); } else setDropOn(id);
      return true;
    }
    setDropOn(null);
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
    /**
     * Carried out of the list and let go on a pane: that pane becomes this
     * session.
     *
     * The same gesture that reorders, ending somewhere else — rather than a
     * second drag on the same rows, which is what the first attempt at this
     * was and why it did not work. An HTML5 `dragstart` on a handle inside
     * the row had to be given a surface the reorder did not use, so it got
     * the icon; the icon is 24 pixels and nobody drags a row by its icon.
     *
     * Unfiltered only, which `enabled` already guarantees: with a search in
     * the box the rows on screen are not the list, and `from` would index the
     * wrong session.
     */
    onDropOut: (from, at) => {
      const id = tabs[from]?.id;
      if (!id) return false;
      for (const [paneId, el] of boxes.current) {
        const r = el.getBoundingClientRect();
        if (r.width <= 0 || r.height <= 0) continue;
        if (at.x < r.left || at.x > r.right || at.y < r.top || at.y > r.bottom) continue;
        const slot = shownRef.current.indexOf(paneId);
        if (slot < 0) return false;
        setShown(swapPane(shownRef.current, slot, id));
        setActive(id);
        return true;
      }
      return false;
    },
  });



  const rows = filter(tabs, query, t('Terminal'));
  // Pruned on every render rather than in an effect: a session can close from
  // the shell exiting, which is not a click and not a state change this
  // component started, and a pane pointing at it would draw nothing.
  const onScreen = prune(shown, tabs.map((x) => x.id));
  shownRef.current = onScreen;
  cwdRef.current = cwds;
  // Every bar action applies to one pane, and it has to be one that is showing.
  const focus = focused(onScreen, active);
  activeRef.current = focus;
  const dead = tabs.find((x) => x.id === focus)?.dead;

  /**
   * Snap the panes to a preset — BridgeMind's Solo / Pair / Workbench / Tidy.
   *
   * `pair` and `workbench` with only one terminal open ask for a second; the
   * new tab lands in `tabs` on the next render, so the preset is held in a ref
   * and applied then. Applying it now would lay out a session that does not
   * exist yet.
   */
  const wanted = useRef<Preset | null>(null);
  /**
   * Whether the panes are two above two rather than four across.
   *
   * Stored rather than derived, and that is the difference between this and
   * every other shape: `describeLayout` can read Solo, Pair and Workbench back
   * out of which panes are drawn and how wide they are, because those *are*
   * widths. Two rows is not a width — the same four panes, evenly sized, are a
   * row or a grid depending only on what somebody asked for, so the asking has
   * to be remembered.
   */
  const [grid, setGrid] = useState(() => localStorage.getItem('vylo.tgrid') === '1');
  useEffect(() => {
    try { localStorage.setItem('vylo.tgrid', grid ? '1' : '0'); } catch { /* private mode */ }
  }, [grid]);

  function snap(preset: Preset) {
    const r = applyPreset(preset, { focus, shown: onScreen, order: tabs.map((x) => x.id), weights });
    if (r.needsNew) { wanted.current = preset; add(true); return; }
    // Every shape but `tidy` says how the panes are arranged, so every shape
    // but `tidy` answers this. Tidy is a repair — it evens out what is there
    // and has no opinion about rows.
    if (preset !== 'tidy') setGrid(preset === 'grid');
    setShown(r.shown);
    setWeights(r.weights);
  }
  useEffect(() => {
    if (!wanted.current || tabs.length < 2) return;
    const preset = wanted.current;
    wanted.current = null;
    if (preset !== 'tidy') setGrid(preset === 'grid');
    const r = applyPreset(preset, { focus, shown: onScreen, order: tabs.map((x) => x.id), weights });
    setShown(r.shown);
    setWeights(r.weights);
    // The set is read at apply time; nothing here should re-run on its own.
  }, [tabs.length]); // eslint-disable-line react-hooks/exhaustive-deps


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
          // The shell's own history first, this session's after it: `suggest`
          // reads from the end, so what was typed here beats what was typed
          // yesterday when both would finish the line.
          history: [...shellPast, ...(history[focus] ?? [])],
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
        // `cd` and its two relatives cannot take a file, so they are not
        // offered one — see `wantsDir`.
        void invoke<string[]>('complete_path', {
          cwd: cwds[focus] || root,
          fragment: fragment(input.line),
          dirsOnly: wantsDir(input.line),
        })
          .then(done)
          .catch(() => done([]));
      }
    }, 90);
    return () => { off = true; window.clearTimeout(id); };
  }, [input, focus, root, cwds, history, shellPast]);

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
  /** Paths on the line, as a person would have typed them. */
  function typePaths(id: string, paths: string[]) {
    const where = cwds[id] || root;
    handles.current.get(id)?.type(
      `${paths.map((x) => quotePath(pathForPrompt(x, where))).join(' ')} `);
  }

  function dropPaths(id: string, paths: string[]) {
    const h = handles.current.get(id);
    if (!h || !paths.length) return;
    setActive(id);
    // A screenshot dragged off the desktop is a hundred characters of
    // `/var/folders/…` that wraps three lines and stops working tomorrow, and
    // it arrived here rather than through the paste handler — which is why the
    // chip did not catch it the first time. Anything short and permanent still
    // lands in one gesture; see `worthHolding`.
    if (paths.some(worthHolding)) {
      pasted.current += 1;
      setHeld({ id, kind: 'files', paths, file: describeFile(paths[0]), n: pasted.current });
      return;
    }
    typePaths(id, paths);
  }

  // Assigned here rather than beside the ref because it carries `focus`, which
  // is only known once the visible set is. Effects run after the whole render,
  // so nothing reads it before this line.
  live.current = { active: focus, expose, exposeRun, exposeFocus };

  return (
    <section className="panel" aria-label={t('Terminal')}>
      <div className="panel-bar">
        {/* The pane you are in, not the panel you are looking at. With one
            session "Terminal" is the whole truth; with six it is the one thing
            the header could say that none of them needed said. Double-click
            renames, which is where somebody whose eye is on the title will
            try it. */}
        <div className="panel-title"
             onDoubleClick={() => { const me = tabs.find((x) => x.id === focus); if (me) rename(me); }}
             title={t('Double-click to rename')}>
          <Icon name="terminal" size={13} />
          {(() => {
            const me = tabs.find((x) => x.id === focus);
            if (!me) return t('Terminal');
            const { text, mono } = titleOf(me, t('Terminal'));
            return <span className={mono ? 'mono' : ''}>{text}</span>;
          })()}
        </div>
        <div className="panel-acts">
          <button className="ghost" onClick={sendToChat} disabled={dead}
                  title={t('Copy the selection, or the last of the output, into the message box')}>
            {t('Send to chat')}
          </button>
          <button className="ghost" onClick={() => handles.current.get(focus)?.clear()} disabled={dead}>
            {t('Clear')}
          </button>
          <button className="ghost icon" onClick={() => setRailHidden((v) => !v)}
                  aria-pressed={!railHidden}
                  title={t(railHidden ? 'Show the sessions' : 'Hide the sessions')}
                  aria-label={t(railHidden ? 'Show the sessions' : 'Hide the sessions')}>
            <Icon name="list" size={14} />
          </button>
          {onAsk && (
            <button className={`ghost tsk-open ${asking ? 'on' : ''}`}
                    onClick={() => { setAsking((v) => !v); setNote(''); }}
                    aria-expanded={asking}
                    title={t('Describe what you want and get a command')}>
              <Icon name="sparkle" size={13} />{t('Ask')}
            </button>
          )}
          <span className="seg lay" role="group" aria-label={t('Layout')}>
            {PRESETS.map((p) => {
              // Grid and Quad are the same widths; only the stored flag
              // tells them apart, so it decides which of the two is lit.
              const shape = describeLayout(onScreen, weights);
              const on = p.id !== 'tidy' && shape === (p.id === 'grid' ? 'quad' : p.id)
                && (p.id === 'grid' || p.id === 'quad' ? grid === (p.id === 'grid') : true);
              return (
                <button key={p.id} className={on ? 'on' : ''} aria-pressed={on}
                        onClick={() => snap(p.id)} title={t(p.about)}>
                  {t(p.label)}
                </button>
              );
            })}
          </span>
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

      {/* One strip, one shell under it — what every other terminal does, and
          what somebody who keeps six shells and looks at one of them wants.
          Above `panel-split` rather than inside it: that is a row of columns,
          and this is a line across all of them. */}
      {view.as === 'tabs' && (
        <div className="ttabs" role="tablist" aria-label={t('Terminal sessions')}>
          {tabs.map((tab) => {
            const title = titleOf(tab, t('Terminal'));
            const state = stateOf(tab);
            return (
              <div key={tab.id} className={`ttab ${tagClass(tab.tag)} ${tab.id === focus ? 'on' : ''}`}
                   onContextMenu={(e) => {
                     e.preventDefault();
                     setRowMenu({ id: tab.id, at: { x: e.clientX, y: e.clientY } });
                   }}>
                <button className="ttab-hit" role="tab" aria-selected={tab.id === focus}
                        onClick={() => { setActive(tab.id); setShown(only(tab.id)); }}
                        onDoubleClick={() => rename(tab)}
                        title={title.text}>
                  <i className={`ttab-dot ${state}`} aria-hidden="true" />
                  <span className={title.mono ? 'mono' : ''}>{title.text}</span>
                </button>
                <button className="ttab-x" onClick={() => close(tab.id)}
                        title={t('Close')} aria-label={`${t('Close')} — ${title.text}`}>
                  <Icon name="close" size={10} />
                </button>
              </div>
            );
          })}
          <button className="ttab-add" onClick={() => add()}
                  title={t('New terminal')} aria-label={t('New terminal')}>
            <Icon name="plus" size={13} />
          </button>
        </div>
      )}

      <div className="panel-split">
        <div className="tsl" role="navigation" aria-label={t('Terminal sessions')}
             style={{ inlineSize: railW, display: listOff ? 'none' : 'flex' }}>
          <div className="tsl-head">
            <span className="tsl-find">
              <Icon name="search" size={13} />
              <input value={query} onChange={(e) => setQuery(e.target.value)}
                     placeholder={t('Search sessions…')} aria-label={t('Search sessions…')}
                     spellCheck={false} />
            </span>
            <button className={`tsl-add ${tuning ? 'on' : ''}`}
                    onClick={() => setTuning((v) => !v)}
                    aria-expanded={tuning}
                    title={t('What the rows show')} aria-label={t('What the rows show')}>
              <Icon name="swap" size={15} />
            </button>
            <button className="tsl-add" onClick={() => add()}
                    title={t('New terminal')} aria-label={t('New terminal')}>
              <Icon name="plus" size={15} />
            </button>
          </div>

          {tuning && (
            <div className="tsv">
              {/* First, because it decides what the rest of this menu is
                  about: with tabs there is no second line to put anything on,
                  so Title and Also show describe a list that is not there. */}
              <div className="tsv-set">
                <span className="tsv-label">{t('View as')}</span>
                <span className="tk-pills">
                  {([['panes', 'Panes'], ['tabs', 'Tabs']] as const).map(([k, label]) => (
                    <button key={k} className={`tk-pill ${view.as === k ? 'on' : ''}`}
                            aria-pressed={view.as === k}
                            onClick={() => {
                              setView((v) => ({ ...v, as: k }));
                              // Tabs shows one shell at a time. Leaving a split
                              // behind would put two panes under a strip that
                              // has one of them lit, which is a window
                              // disagreeing with itself.
                              if (k === 'tabs') setShown(only(focus));
                            }}>{t(label)}</button>
                  ))}
                </span>
              </div>
              <div className="tsv-set">
                <span className="tsv-label">{t('Title')}</span>
                <span className="tk-pills">
                  {([['command', 'Last command'], ['cwd', 'Folder'], ['branch', 'Branch']] as const).map(([k, label]) => (
                    <button key={k} className={`tk-pill ${view.titleAs === k ? 'on' : ''}`}
                            aria-pressed={view.titleAs === k}
                            onClick={() => setView((v) => ({ ...v, titleAs: k }))}>{t(label)}</button>
                  ))}
                </span>
              </div>
              <div className="tsv-set">
                <span className="tsv-label">{t('Also show')}</span>
                <span className="tk-pills">
                  {([['state', 'State'], ['branch', 'Branch'], ['cwd', 'Folder']] as const).map(([k, label]) => (
                    <button key={k} className={`tk-pill ${view.meta[k] ? 'on' : ''}`}
                            aria-pressed={view.meta[k]}
                            onClick={() => setView((v) => ({ ...v, meta: { ...v.meta, [k]: !v.meta[k] } }))}>
                      {t(label)}
                    </button>
                  ))}
                </span>
              </div>
              <div className="tsv-set">
                <span className="tsv-label">{t('Density')}</span>
                <span className="tk-pills">
                  {([['comfortable', 'Comfortable'], ['compact', 'Compact']] as const).map(([k, label]) => (
                    <button key={k} className={`tk-pill ${view.density === k ? 'on' : ''}`}
                            aria-pressed={view.density === k}
                            onClick={() => setView((v) => ({ ...v, density: k }))}>{t(label)}</button>
                  ))}
                </span>
              </div>
            </div>
          )}

          <div {...drag.strip} className={`tsl-list ${view.density} ${drag.strip.className}`}>
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
              const row = rowOf(tab, factsFor(tab.id), view,
                { term: t('Terminal'), home, now: clock, t });
              // The state badge, drawn the same whether the row is being read
              // or renamed — one copy, so the row cannot change shape under
              // somebody halfway through typing a name.
              const mark = (
                /* The icon was briefly a drag handle of its own, for sending
                   this session to a pane. The row does that now — see
                   `onDropOut` — and two gestures on one row is how they end up
                   fighting for the pointer. */
                <span className={`tsl-mark ${state}`}>
                  <Icon name="terminal" size={14} />
                  {/* The badge carries the state, so the second line is free
                      to say something the badge cannot. */}
                  <i className="tsl-dot" aria-hidden="true">
                    {state === 'ok' && <Icon name="check" size={9} />}
                    {state === 'failed' && <Icon name="warning" size={9} />}
                  </i>
                </span>
              );
              const sub = (
                /* The second line says whatever the view asks it to. Six
                   shells all called "Terminal" tell you nothing; the last
                   command, the folder or the branch do. */
                <span className="tsl-sub">
                  {row.subs.map((x) => (
                    <span key={x.kind} className={`tsl-${x.kind}`}>
                      {x.kind === 'branch' && <Icon name="branch" size={9} />}
                      {x.text}
                    </span>
                  ))}
                </span>
              );
              return (
                <div key={tab.id} className={`tsl-row ${tagClass(tab.tag)} ${drag.itemClass(i)} ${onScreen.includes(tab.id) ? 'on' : ''}`}
                     onContextMenu={(e) => {
                       e.preventDefault();
                       setRowMenu({ id: tab.id, at: { x: e.clientX, y: e.clientY } });
                     }}>
                  {renaming === tab.id ? (
                    /* A field where the name is, holding the name, so what is
                       being changed and what it will look like are the same
                       pixels. Not inside the button below: an input in a
                       button is invalid, and the button swallows the clicks
                       that would put a caret in it. */
                    <div className="tsl-pick editing">
                      {mark}
                      <span className="tsl-text">
                        <input className="tsl-rename" data-nodrag autoFocus
                               defaultValue={titleOf(tab, t('Terminal')).text}
                               aria-label={t('Rename this terminal')}
                               onFocus={(e) => e.currentTarget.select()}
                               onBlur={(e) => {
                                 // Escape has already said not to save. A
                                 // removed node does not fire blur in any
                                 // browser this ships on, but relying on that
                                 // would make cancelling depend on it.
                                 if (cancelRename.current) { cancelRename.current = false; return; }
                                 named(tab.id, e.currentTarget.value);
                               }}
                               onKeyDown={(e) => {
                                 e.stopPropagation();
                                 if (e.key === 'Enter') { named(tab.id, e.currentTarget.value); return; }
                                 if (e.key === 'Escape') { cancelRename.current = true; setRenaming(null); }
                               }} />
                        {sub}
                      </span>
                    </div>
                  ) : (
                    /* Clicking a row means "show me this one", as it always
                       has. Showing it *as well* is the button below, so the
                       ordinary click never has to be learnt twice. */
                    <button className="tsl-pick"
                            onClick={() => { setActive(tab.id); setShown(only(tab.id)); }}
                            onDoubleClick={() => rename(tab)}
                            aria-current={tab.id === focus ? 'true' : undefined}>
                      {mark}
                      <span className="tsl-text">
                        <span className={`tsl-name ${row.mono ? 'mono' : ''}`}
                              title={row.title}>{row.title}</span>
                        {sub}
                      </span>
                    </button>
                  )}
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
                          title={t('More')} aria-label={`${t('More')} — ${row.title}`}>
                    <Icon name="ellipsis" size={13} />
                  </button>
                </div>
              );
            })}
          </div>
        </div>

      {/* The line between the rail and the panes. Same design as the pane
          dividers: a 1px line you see, six pixels you hit. Double-click puts
          the width back. */}
      {!listOff && (
        <div className="tdiv" role="separator" aria-orientation="vertical" tabIndex={0}
             aria-label={t('Resize the sessions list')}
             title={t('Drag to resize, double-click to reset')}
             onPointerDown={dragRail}
             onDoubleClick={() => setRailW(236)}
             onKeyDown={(e) => {
               const by = e.key === 'ArrowRight' ? 12 : e.key === 'ArrowLeft' ? -12 : 0;
               if (!by) return;
               e.preventDefault();
               setRailW((w) => Math.min(Math.max(w + by, 160), 420));
             }} />
      )}

      {/* `grid` only bites with more than two panes: two above one another is
          not what anybody means by a grid, and a single pane in one would be
          half a panel of empty space. */}
      <div ref={row} className={`panel-body ${onScreen.length > 1 ? 'split' : ''} ${grid && onScreen.length > 2 ? 'grid' : ''}`}>
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

            <div className={`tpane ${tagClass(tab.tag)} ${on && tab.id === focus ? 'on' : ''} ${dropOn === tab.id ? (lifting ? 'taking' : 'dropping') : ''} ${lifting === tab.id ? 'lifting' : ''} ${drag.dragging && on ? 'can-take' : ''}`}
                 ref={(el) => {
                   // Only drawn panes are droppable; a hidden one has no box.
                   if (el && on) boxes.current.set(tab.id, el);
                   else boxes.current.delete(tab.id);
                 }}
                 style={{ display: on ? 'flex' : 'none', flexGrow: width * onScreen.length }}
                 onMouseDown={() => setActive(tab.id)}
                 /**
                  * A row dragged out of the explorer, which is a different
                  * mechanism from a file dragged out of Finder: that one comes
                  * through Tauri's window drag-drop with an absolute path,
                  * this one is an ordinary HTML drag carrying the path as the
                  * tree knows it. Both end in the same place.
                  */
                 onDragOver={(e) => {
                   // A pane dropped on a pane changes places with it. Checked
                   // first because a drag carries both types only if something
                   // has gone wrong, and a pane is the more specific answer.
                   if (e.dataTransfer.types.includes(DRAG_PANE)) {
                     if (lifting === tab.id) return;
                     e.preventDefault();
                     e.dataTransfer.dropEffect = 'move';
                     setDropOn(tab.id);
                     return;
                   }
                   if (!e.dataTransfer.types.includes(DRAG_PATH)) return;
                   // Without this the browser refuses the drop and the drag
                   // springs back, which reads as "the terminal will not take
                   // it" rather than as a missing line of code.
                   e.preventDefault();
                   e.dataTransfer.dropEffect = 'copy';
                   setDropOn(tab.id);
                 }}
                 onDragLeave={(e) => {
                   // Moving between a row's children fires this too, so only a
                   // pointer that has actually left the pane counts.
                   if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
                   setDropOn((c) => (c === tab.id ? null : c));
                 }}
                 onDrop={(e) => {
                   const moved = e.dataTransfer.getData(DRAG_PANE);
                   if (moved) {
                     e.preventDefault();
                     setDropOn(null);
                     setLifting(null);
                     // The same exchange the name's picker makes — see
                     // `swap`: two panes on one shell would both be live.
                     setShown(swapPane(onScreen, at, moved));
                     setActive(moved);
                     return;
                   }
                   const rel = e.dataTransfer.getData(DRAG_PATH);
                   setDropOn(null);
                   if (!rel) return;
                   e.preventDefault();
                   setActive(tab.id);
                   // As a person would have typed it: relative when the file
                   // is inside the shell's own directory, whole when it is not.
                   const abs = under(root, rel);
                   handles.current.get(tab.id)?.type(
                     `${quotePath(pathForPrompt(abs, cwds[tab.id] || root))} `);
                 }}>
              {/* Side by side, two panes are two anonymous dark rectangles
                  without a name on them. One pane needs no label: the row it
                  came from is already lit in the list beside it. */}
              {onScreen.length > 1 && (
                <div className="tpane-head">
                  {/* The name is a picker.
                      The list beside the panes answers "show this as well" and
                      "hide this"; it has no way to say "show this *here*",
                      and with four slots that is the question — the row is an
                      arrangement, and changing what is in one of them should
                      not rearrange the rest. A session already drawn trades
                      places with this one rather than appearing twice: two
                      panes on one shell are both live, each echoing the
                      other's keystrokes. */}
                  <span className={`tpane-name ${title.mono ? 'mono' : ''}`} title={title.text}
                        draggable
                        onDragStart={(e) => {
                          // The name, not the pane: a terminal is full of
                          // selectable text, and making the whole thing a drag
                          // source would mean nobody could select any of it.
                          e.dataTransfer.setData(DRAG_PANE, tab.id);
                          e.dataTransfer.effectAllowed = 'move';
                          setLifting(tab.id);
                        }}
                        onDragEnd={() => { setLifting(null); setDropOn(null); }}>
                    {title.text}
                    <Icon name="chevron" size={9} turn={90} />
                    <select value={tab.id}
                            aria-label={t('Which terminal shows here')}
                            onChange={(e) => {
                              setShown(swapPane(onScreen, at, e.target.value));
                              setActive(e.target.value);
                            }}>
                      {tabs.map((x) => (
                        <option key={x.id} value={x.id}>{titleOf(x, t('Terminal')).text}</option>
                      ))}
                    </select>
                  </span>
                  <button className="tsl-x"
                          onClick={() => setShown(togglePane(onScreen, tab.id, tabs.map((x) => x.id)))}
                          title={t('Hide this pane')} aria-label={`${t('Hide this pane')} — ${title.text}`}>
                    <Icon name="close" size={11} />
                  </button>
                </div>
              )}
              <TerminalView
                // Used once, when the view mounts: after that the pane has its
                // own shell and its own scrollback.
                restore={restoring.get(tab.id)?.text || undefined}
                onMoved={() => locate(tab.id)}
                onTyped={(st) => { if (tab.id === focus) setInput(st); }}
                // A line goes into history when it is sent, and only from the
                // tracker — which means only lines this app is sure it saw
                // whole. A recalled or tab-completed line is not remembered
                // twice-wrong; it is not remembered at all.
                onSent={(line) => setHistory((h) => ({ ...h, [tab.id]: remember(h[tab.id] ?? [], line) }))}
                onDropPaths={(paths) => dropPaths(tab.id, paths)}
                /**
                 * Hold a bulk paste; let an ordinary one through.
                 *
                 * Returning false is the default and costs nothing — the event
                 * is left alone and the paste happens exactly as it always
                 * did. Only the blob case is taken, so the common paste of a
                 * command somebody copied is not a decision they have to make.
                 */
                onPaste={(text) => {
                  // A file first. macOS puts a screenshot's path on the
                  // clipboard as text, and it is short enough and single
                  // enough that the bulk rule below would wave it through as
                  // sixty characters of `/var/folders/…` at the prompt.
                  const file = pastedFile(text);
                  if (file && worthHolding(file.path)) {
                    pasted.current += 1;
                    setHeld({ id: tab.id, kind: 'files', paths: [file.path], file, n: pasted.current });
                    return true;
                  }
                  if (!isBulk(text)) return false;
                  setHeld({ id: tab.id, kind: 'text', text });
                  return true;
                }}
                onKey={(e) => {
                  // A held paste answers first: it is the one thing on screen
                  // that is waiting for a decision, and Enter with text held
                  // and no decision made would send the line underneath it
                  // while the paste sat there unexplained.
                  if (held?.id === tab.id) {
                    if (e.key === 'Enter') {
                      // Files go in as quoted paths; text goes in as a paste,
                      // so the program on the other end gets whatever
                      // bracketing it asked for.
                      if (held.kind === 'files') typePaths(tab.id, held.paths);
                      else handles.current.get(tab.id)?.paste(held.text);
                      setHeld(null);
                      return true;
                    }
                    if (e.key === 'Escape') { setHeld(null); return true; }
                  }
                  // Only while a list is showing, and only for this pane.
                  // A full-screen program owns every key while it is up.
                  // Taking Tab from Claude Code to offer a shell completion is
                  // the app answering a question the shell was not asked.
                  if (handles.current.get(tab.id)?.fullScreen()) return false;
                  if (tab.id !== focus || !worth(input, matches)) return false;
                  if (e.key === 'Escape') { setMatches([]); return true; }
                  if (e.key === 'ArrowDown') { setPickAt((n) => (n + 1) % matches.length); return true; }
                  if (e.key === 'ArrowUp') { setPickAt((n) => (n - 1 + matches.length) % matches.length); return true; }
                  // Tab takes the choice. The shell's own completion is what
                  // this is standing in for, so taking the key here is the
                  // whole point — and pressing it with no list showing falls
                  // through to the shell as it always did.
                  if (e.key === 'Tab') { take(matches[pickAt] ?? matches[0]); return true; }
                  /**
                   * Right arrow takes it too, which is fish's gesture and
                   * Warp's, and it is safe here for a reason worth writing
                   * down: `sure` is false after any escape sequence, and every
                   * key that moves the caret off the end of the line — an
                   * arrow, Home, Ctrl-A — is one. So a list on screen *is* a
                   * caret at the end of the line, where Right does nothing at
                   * all. Nothing is taken from the shell by taking it here.
                   *
                   * Modified arrows are left alone: Alt-Right is a word jump
                   * in every shell, and Shift-Right starts a selection.
                   */
                  if (e.key === 'ArrowRight' && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
                    take(matches[pickAt] ?? matches[0]);
                    return true;
                  }
                  return false;
                }}
                cwd={restoring.get(tab.id)?.cwd || root}
                dark={dark}
                visible={on}
                onReady={(h) => { if (h) handles.current.set(tab.id, h); else handles.current.delete(tab.id); }}
                command={tab.command}
                onExit={(code) => exited(tab, code)}
                onData={tab.command ? (chunk) => runs.current.get(tab.id)?.buffer.push(chunk) : undefined}
                onError={onError}
              />

              {/* A file is over this pane and letting go will put its path at
                  the prompt. Said here rather than as an overlay across the
                  terminal: the text underneath is what somebody is dragging
                  the file *to*, and covering it up to announce the drop hides
                  the reason for it. */}
              {dropOn === tab.id && (
                <div className="tdrop"><Icon name="attach" size={12} />{t('Drop to put the path at the prompt')}</div>
              )}

              {/* Text pasted and not yet sent. Nothing reaches the shell until
                  the button below is pressed — see paste.ts for why a bulk
                  paste is the one path into a prompt that was not already a
                  decision somebody made. */}
              {held?.id === tab.id && held.kind === 'files' && (
                /* `image #1`, not the path. The path is the answer and the
                   chip is the question, and sixty characters of
                   `/var/folders/xy/8dln…` asks nothing anybody can read. What
                   goes to the shell when this is taken is still the real
                   path, quoted — a placeholder would be a name no shell
                   knows. */
                <div className="tpaste file" role="status">
                  <Icon name={held.file.image ? 'image' : 'file'} size={12} />
                  <span className="tpaste-what">
                    <b>{fill(t(held.file.image ? 'image #{n}' : 'file #{n}'), { n: held.n })}</b>
                    <code>{held.paths.length > 1
                      ? fill(t('{name} and {n} more'), { name: held.file.name, n: held.paths.length - 1 })
                      : held.file.name}</code>
                  </span>
                  {held.file.temporary && <em>{t('temporary — copy it somewhere to keep it')}</em>}
                  <button className="tpaste-go" onClick={() => {
                    typePaths(tab.id, held.paths);
                    setHeld(null);
                  }}>{t('Paste the path')}<kbd>⏎</kbd></button>
                  <button className="tpaste-no" onClick={() => setHeld(null)}
                          aria-label={t('Discard')}><Icon name="close" size={11} /></button>
                </div>
              )}

              {held?.id === tab.id && held.kind === 'text' && (() => {
                const info = pasteInfo(held.text);
                return (
                  <div className={`tpaste ${info.runs ? 'runs' : ''}`} role="status">
                    <Icon name={info.runs ? 'warning' : 'clipboard'} size={12} />
                    <span className="tpaste-what">
                      <b>{fill(t('{n} lines · {size}'), { n: info.lines, size: pasteSize(info.bytes) })}</b>
                      <code>{pasteHead(held.text)}</code>
                    </span>
                    {info.runs && <em>{t('ends with a return, so it will run')}</em>}
                    <button className="tpaste-go" onClick={() => {
                      handles.current.get(tab.id)?.paste(held.text);
                      setHeld(null);
                    }}>{t('Paste')}<kbd>⏎</kbd></button>
                    <button className="tpaste-no" onClick={() => setHeld(null)}
                            aria-label={t('Discard')}><Icon name="close" size={11} /></button>
                  </div>
                );
              })()}

              {/* What could finish the line.
                  Docked at the foot of the pane rather than floated at the
                  cursor: a prompt sits at the bottom of a terminal almost all
                  the time, because output scrolls up — so this is where the
                  cursor is, without measuring a character cell to find out. */}
              {tab.id === focus && worth(input, matches)
                && !handles.current.get(tab.id)?.fullScreen() && (
                <div className="sug" role="listbox" aria-label={t('Completions')}>
                  {/* The line as it would read, before the list of what else
                      it could be. The pane's own caret is somewhere up in the
                      scrollback and finding it means measuring a character
                      cell; this says the same thing a character ahead of the
                      cursor would, in a place that is always correct. */}
                  {(() => {
                    const best = matches[pickAt] ?? matches[0];
                    const line = preview(input.line, best);
                    // Case-insensitive matching means the completion can
                    // rewrite what was typed — `app` choosing `App.js`. When
                    // it does, the whole line is the new text rather than a
                    // tail added to the old, and showing it any other way
                    // would claim characters are staying that are not.
                    const kept = line.startsWith(input.line) ? input.line.length : 0;
                    return (
                      <div className="sug-ghost" aria-hidden="true">
                        <b>{line.slice(0, kept)}</b><span>{line.slice(kept)}</span>
                      </div>
                    );
                  })()}
                  <div className="sug-list">
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
                  <span className="sug-hint">{t('Tab or → to take it')}</span>
                  </div>
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
