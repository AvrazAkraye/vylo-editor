import { useEffect, useRef } from 'react';
import { Channel, invoke } from '@tauri-apps/api/core';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
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

type PtyEvent = { kind: 'data'; data: string } | { kind: 'exit' };

export interface TermHandle {
  focus(): void;
  fit(): void;
  clear(): void;
  /** The selection if there is one, else the last `lines` non-blank rows. */
  text(lines: number): string;
}

interface Props {
  cwd: string;
  dark: boolean;
  visible: boolean;
  onReady: (h: TermHandle | null) => void;
  onExit: () => void;
  onError: (message: string) => void;
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

export function TerminalView({ cwd, dark, visible, onReady, onExit, onError }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fit = useRef<FitAddon | null>(null);
  // Props the long-lived pty callbacks need to read at call time rather than
  // capture at mount time.
  const cb = useRef({ onExit, onError });
  cb.current = { onExit, onError };

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    const t = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.25,
      cursorBlink: true,
      scrollback: 8000,
      // Alt should compose characters on a Mac keyboard, not send Esc.
      macOptionIsMeta: false,
      theme: palette(dark),
    });
    const f = new FitAddon();
    t.loadAddon(f);
    t.open(el);
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
      if (m.kind === 'data') t.write(m.data);
      else if (!closed) { closed = true; cb.current.onExit(); }
    };

    void invoke<number>('pty_open', {
      cwd: cwd || null,
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
      .catch((e) => cb.current.onError(String(e instanceof Error ? e.message : e)));

    const typed = t.onData((d) => {
      if (ptyId !== null) void invoke('pty_write', { id: ptyId, data: d }).catch(() => {});
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
      clear: () => t.clear(),
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
