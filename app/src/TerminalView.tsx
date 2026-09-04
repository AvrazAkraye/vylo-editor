import { explain } from './errors';
import { useEffect, useRef } from 'react';
import { Channel, invoke } from '@tauri-apps/api/core';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { NOTHING, typed as fold, type Typed } from './suggest';
import { BANNER } from './scrollback';
import '@xterm/xterm/css/xterm.css';

/**
 * One shell, in one pane.
 *
 * The pane owns its xterm instance and its pty for its whole lifetime, so the
 * open effect deliberately depends on nothing: a prop change must never be able
 * to restart someone's shell out from under them. Theme changes are applied to
 * the live instance instead, and the pane is kept mounted while hidden so that
 * switching tabs does not lose the scrollback.
 */

type PtyEvent = { kind: 'data'; data: string } | { kind: 'exit'; code: number | null };

export interface TermHandle {
  focus(): void;
  fit(): void;
  /**
   * Where the shell is now.
   *
   * Asked rather than watched: a directory only changes when a command runs,
   * so polling on a timer would be a subprocess-sized question asked four
   * times a second for an answer that is almost always the same one.
   */
  cwd(): Promise<string>;
  clear(): void;
  /** Put keystrokes on the input line, as if typed. */
  type(data: string): void;
  /**
   * The scrollback, as lines, for saving.
   *
   * Read from the buffer rather than from the bytes the shell sent — see
   * scrollback.ts. It also means a full-screen program is handled by doing
   * nothing: its frames are on the alternate screen, and this is the other one.
   */
  lines(): string[];
  /**
   * True while a full-screen program owns the terminal.
   *
   * There is no shell prompt on the alternate screen, so there is nothing to
   * complete and no key to take — Tab belongs to Claude Code, not to us.
   */
  fullScreen(): boolean;
  /** The selection if there is one, else the last `lines` non-blank rows. */
  text(lines: number): string;
}

interface Props {
  cwd: string;
  dark: boolean;
  visible: boolean;
  /** When set, the pty runs this instead of an interactive shell. */
  command?: string;
  onReady: (h: TermHandle | null) => void;
  /** `code` is the command's exit status when this pane was running one. */
  onExit: (code: number | null) => void;
  onError: (message: string) => void;
  /** A command was sent, so the shell may have moved. */
  onMoved?: () => void;
  /** What is believed to be on the input line, as it is typed. */
  onTyped?: (state: Typed) => void;
  /** A line was sent. Only fires for one this app saw whole — see suggest.ts. */
  onSent?: (line: string) => void;
  /** Files were dropped on this pane. */
  onDropPaths?: (paths: string[]) => void;
  /**
   * What this pane had in it last time, written before the shell starts.
   *
   * Followed by a banner saying the shell is new, because a transcript above a
   * live prompt with no line between them is a dead process wearing a live
   * one's clothes.
   */
  restore?: string;
  /**
   * A key the suggestion list wants instead of the shell.
   *
   * Returns true when it took it. Arrows and Tab mean something to a shell too,
   * so this is asked first and only while a list is showing — a handler that
   * swallowed Tab unconditionally would break the shell's own completion, which
   * is the thing people would miss most.
   */
  onKey?: (e: KeyboardEvent) => boolean;
  /** Raw pty bytes, for a pane whose output is going back to the agent. */
  onData?: (chunk: string) => void;
}

/**
 * ANSI is sixteen named colours, and programs choose among them assuming a
 * readable contrast against the background. Inverting a dark palette for light
 * mode gives you yellow-on-white; these are two palettes, picked separately.
 */
function palette(dark: boolean) {
  return dark
    ? {
        background: '#121118', foreground: '#ECEAF5',
        cursor: '#A99AFF', cursorAccent: '#121118',
        selectionBackground: 'rgba(169,154,255,.30)',
        black: '#2C2A39', red: '#F0897C', green: '#6BD6AE', yellow: '#E0AE5C',
        blue: '#8FB8FF', magenta: '#C4A9FF', cyan: '#6FD8DC', white: '#ECEAF5',
        brightBlack: '#6B6880', brightRed: '#FF9F93', brightGreen: '#86ECC4',
        brightYellow: '#F5C877', brightBlue: '#A9CBFF', brightMagenta: '#D8C2FF',
        brightCyan: '#8CEAEE', brightWhite: '#FFFFFF',
      }
    : {
        background: '#FBFAFD', foreground: '#16151D',
        cursor: '#5B4DE0', cursorAccent: '#FBFAFD',
        selectionBackground: 'rgba(91,77,224,.20)',
        black: '#16151D', red: '#A8332A', green: '#17694C', yellow: '#96620F',
        blue: '#23458F', magenta: '#6D3FA8', cyan: '#0F6A72', white: '#D6D2E6',
        brightBlack: '#46435A', brightRed: '#C7554A', brightGreen: '#2A8C69',
        brightYellow: '#B9822B', brightBlue: '#3A63B8', brightMagenta: '#8B5CF6',
        brightCyan: '#16909A', brightWhite: '#6F6C84',
      };
}

export function TerminalView({ cwd, dark, visible, command, onReady, onExit, onError, onData, onMoved, onTyped, onSent, onKey, onDropPaths, restore }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  /** What is believed to be on the input line. */
  const line = useRef<Typed>(NOTHING);
  /**
   * The callbacks, through a ref.
   *
   * They are inline arrows from the parent and change on every render, while
   * the terminal is built once — reading them at call time is what keeps the
   * effect from tearing down a live shell to pick up a new closure.
   */
  const keys = useRef({ onTyped, onSent, onKey, onDropPaths });
  keys.current = { onTyped, onSent, onKey, onDropPaths };
  // Props the long-lived pty callbacks need to read at call time rather than
  // capture at mount time.
  const cb = useRef({ onExit, onError, onData });
  cb.current = { onExit, onError, onData };

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    const t = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      // 13, not 12. A terminal is read for minutes at a time and the panel is
      // wide enough for it.
      fontSize: 13,
      lineHeight: 1.3,
      cursorBlink: true,
      scrollback: 8000,
      // Alt should compose characters on a Mac keyboard, not send Esc.
      macOptionIsMeta: false,
      theme: palette(dark),
    });
    const f = new FitAddon();
    t.loadAddon(f);
    /**
     * The suggestion list gets first refusal on a keypress.
     *
     * Only asked while a list is on screen, and it says whether it took the
     * key. Arrows, Tab and Escape all mean something to a shell, so a handler
     * that swallowed them unconditionally would break history recall and the
     * shell's own completion — which is the thing people would miss most.
     *
     * Returning false from this handler is what tells xterm to send the key on
     * to the pty as usual.
     */
    t.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown') return true;
      return !keys.current.onKey?.(e);
    });

    t.open(el);

    // Before the pty, so the shell's first prompt lands under this rather than
    // racing it. Dim, because a transcript is a record and not output.
    if (restore) {
      t.write(`${restore.replace(/\n/g, '\r\n')}\r\n`);
      t.write(`\x1b[2m${BANNER}\x1b[0m\r\n`);
    }
    term.current = t;
    fit.current = f;
    try { f.fit(); } catch { /* zero-sized while the panel animates open */ }

    // Per-run rather than in a ref, deliberately. StrictMode mounts, tears
    // down and mounts again in development; shared refs would let the first
    // run's pty id land in the second run's slot, and the first shell would be
    // left running with nothing holding its id.
    let ptyId: number | null = null;
    let disposed = false;
    let closed = false;
    const channel = new Channel<PtyEvent>();
    channel.onmessage = (m) => {
      // The reader thread can have a frame in flight when the pane goes away,
      // and writing to a disposed terminal throws.
      if (disposed) return;
      if (m.kind === 'data') { t.write(m.data); cb.current.onData?.(m.data); }
      else if (!closed) { closed = true; cb.current.onExit(m.code); }
    };

    void invoke<number>('pty_open', {
      cwd: cwd || null,
      command: command || null,
      cols: t.cols,
      rows: t.rows,
      onEvent: channel,
    })
      .then((n) => {
        // The pane can unmount before the shell finishes starting; without this
        // the session is orphaned with nothing left holding its id.
        if (disposed) { void invoke('pty_close', { id: n }); return; }
        ptyId = n;
        // The pane may have been laid out while the shell was starting, in
        // which case the size it was opened with is already stale.
        void invoke('pty_resize', { id: n, cols: t.cols, rows: t.rows }).catch(() => {});
        t.focus();
      })
      .catch((e) => cb.current.onError(explain(e, 'open a terminal')));

    const typed = t.onData((d) => {
      if (ptyId !== null) void invoke('pty_write', { id: ptyId, data: d }).catch(() => {});
      // Every keystroke passes through here on its way to the pty, which is why
      // the input line is counted rather than read off the screen — see
      // suggest.ts.
      // Read the line *before* folding: Enter clears it, and what was on it is
      // exactly what was just sent.
      if (d.includes('\r') && line.current.sure && line.current.line.trim()) {
        keys.current.onSent?.(line.current.line);
      }
      // A full-screen program has no shell prompt, so there is no line to
      // track and nothing that could be completed. Saying "not sure" is what
      // keeps the suggestion list off the screen while Claude Code is running.
      line.current = t.buffer.active.type === 'alternate'
        ? { line: '', sure: false }
        : fold(line.current, d);
      keys.current.onTyped?.(line.current);
      // A directory changes when a command finishes, and a command finishes
      // after Enter. The delay is for the shell to have actually run it —
      // asking in the same tick reads the directory it was in before.
      if (d.includes('\r')) window.setTimeout(() => onMoved?.(), 120);
    });

    // The pane is resized by the window, by the sidebar divider and by the
    // panel's own height handle, so observe the element rather than the window.
    const ro = new ResizeObserver(() => {
      if (!el.clientWidth || !el.clientHeight) return;
      try { f.fit(); } catch { return; }
      if (ptyId !== null) {
        void invoke('pty_resize', { id: ptyId, cols: t.cols, rows: t.rows }).catch(() => {});
      }
    });
    ro.observe(el);

    onReady({
      focus: () => t.focus(),
      fit: () => { try { f.fit(); } catch { /* hidden */ } },
      cwd: async () => (ptyId === null ? '' : invoke<string>('pty_cwd', { id: ptyId }).catch(() => '')),
      clear: () => t.clear(),
      /**
       * Put keystrokes on the input line, as if typed.
       *
       * Goes through the same `pty_write` a keypress does, and through the
       * tracker with it — so the completion this inserts is counted, and the
       * next suggestion is about the line as it now stands rather than the one
       * before it.
       */
      lines: () => {
        const buf = t.buffer.active;
        const out: string[] = [];
        // `length` spans the scrollback and the screen; `translateToString`
        // with trimRight drops the padding a terminal keeps to its width.
        for (let i = 0; i < buf.length; i++) {
          out.push(buf.getLine(i)?.translateToString(true) ?? '');
        }
        return out;
      },
      fullScreen: () => t.buffer.active.type === 'alternate',
      type: (data) => {
        if (ptyId !== null) void invoke('pty_write', { id: ptyId, data }).catch(() => {});
        line.current = fold(line.current, data);
        keys.current.onTyped?.(line.current);
        t.focus();
      },
      text: (lines) => {
        const sel = t.getSelection();
        if (sel.trim()) return sel;
        const buf = t.buffer.active;
        const end = buf.baseY + buf.cursorY;
        const out: string[] = [];
        for (let i = Math.max(0, end - lines); i <= end; i++) {
          out.push(buf.getLine(i)?.translateToString(true) ?? '');
        }
        while (out.length && !out[out.length - 1].trim()) out.pop();
        while (out.length && !out[0].trim()) out.shift();
        return out.join('\n');
      },
    });

    return () => {
      disposed = true;
      onReady(null);
      ro.disconnect();
      typed.dispose();
      if (ptyId !== null) void invoke('pty_close', { id: ptyId }).catch(() => {});
      ptyId = null;
      t.dispose();
    };
    // Mount only. Restarting a shell because a prop changed would be a bug, not
    // a refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { const t = term.current; if (t) t.options.theme = palette(dark); }, [dark]);

  // Becoming visible after being display:none leaves xterm sized for a zero-
  // width box, so re-fit on the way in.
  useEffect(() => {
    if (!visible) return;
    const h = window.setTimeout(() => {
      try { fit.current?.fit(); } catch { /* not laid out yet */ }
      term.current?.focus();
    }, 0);
    return () => window.clearTimeout(h);
  }, [visible]);

  return <div className="term-host" ref={host} style={{ display: visible ? 'block' : 'none' }} />;
}
