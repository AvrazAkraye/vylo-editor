import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';

/**
 * The window's close, minimise and zoom buttons, drawn by the app.
 *
 * macOS's own three are hidden — `src-tauri/src/mac.rs` says how, and why that
 * is done rather than turning the whole title bar off. What is left is a set of
 * buttons the app controls, which is the point: they can carry the app's focus
 * ring, its reduced-motion rule and its four languages, none of which the
 * native ones can be told about.
 *
 * ## Copying the behaviour, not just the circles
 *
 * Three circles are easy and read as a cheap imitation without the behaviour
 * underneath, which is what people actually recognise:
 *
 * - **The glyphs appear on hovering any of the three**, not the one under the
 *   pointer. That is what macOS does, and doing it per-button is the single
 *   most common tell that a set of traffic lights was redrawn.
 * - **They go grey when the window is not focused**, all three, and show no
 *   glyphs while they are. A background window with three coloured dots looks
 *   active, which is the one thing this widget exists to communicate.
 * - **The green button is full screen, and ⌥-click is zoom.** That has been the
 *   order since 10.10; getting it backwards is the second tell.
 *
 * ## Close means close, not quit
 *
 * `close()`, never `destroy()`. Closing goes through the window's
 * `onCloseRequested` handler, which is where F3's guard lives — the one that
 * stops a dirty buffer, a staged change and a turn in flight from disappearing
 * without being mentioned. `destroy()` would skip it, and this button would
 * become the one way to lose work in an app built to make that impossible.
 */

interface Props {
  /** True while the window is filling the screen; the buttons hide. */
  full: boolean;
  /** The app's own full-screen toggle, so ⌃⌘F and the green button agree. */
  onFullscreen: () => void;
  t: (s: string) => string;
}

export function TrafficLights({ full, onFullscreen, t }: Props) {
  const [focused, setFocused] = useState(true);
  const [held, setHeld] = useState<string | null>(null);

  useEffect(() => {
    const win = getCurrentWindow();
    let stop: (() => void) | undefined;
    void win.onFocusChanged(({ payload }) => setFocused(payload)).then((un) => {
      stop = un;
    });
    // A button released outside the circle it was pressed in must not stay
    // looking pressed, and the mouseup never reaches the button.
    const up = () => setHeld(null);
    window.addEventListener('mouseup', up);
    return () => { stop?.(); window.removeEventListener('mouseup', up); };
  }, []);

  // Full screen puts the real title bar back on hover, with the real buttons in
  // it. Two sets would be one too many.
  if (full) return null;

  const win = getCurrentWindow();
  const press = (id: string) => ({
    onMouseDown: () => setHeld(id),
    onMouseUp: () => setHeld(null),
  });

  return (
    <div className={`tl ${focused ? '' : 'idle'}`} role="group" aria-label={t('Window')}>
      <button className={`tl-b close ${held === 'close' ? 'held' : ''}`}
              {...press('close')}
              onClick={() => void win.close()}
              title={t('Close')} aria-label={t('Close')}>
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M3 3l4 4M7 3l-4 4" />
        </svg>
      </button>

      <button className={`tl-b min ${held === 'min' ? 'held' : ''}`}
              {...press('min')}
              onClick={() => void win.minimize()}
              title={t('Minimise')} aria-label={t('Minimise')}>
        <svg viewBox="0 0 10 10" aria-hidden="true">
          <path d="M2.5 5h5" />
        </svg>
      </button>

      <button className={`tl-b zoom ${held === 'zoom' ? 'held' : ''}`}
              {...press('zoom')}
              onClick={(e) => {
                // macOS: the green button is full screen, and holding option
                // makes it zoom instead. Both are here so the habit works.
                if (e.altKey) void win.toggleMaximize();
                else onFullscreen();
              }}
              title={t('Full screen — hold Option to zoom')}
              aria-label={t('Full screen — hold Option to zoom')}>
        {/* Two filled triangles pointing apart, which is the full-screen glyph.
            The zoom glyph macOS shows under Option is a different pair; one is
            enough at six pixels. */}
        <svg viewBox="0 0 10 10" aria-hidden="true" className="fill">
          <path d="M2 8V4.6L5.4 8z" />
          <path d="M8 2v3.4L4.6 2z" />
        </svg>
      </button>
    </div>
  );
}

/**
 * Ask macOS to hide its buttons again.
 *
 * Entering and leaving full screen rebuilds the title bar, and the native
 * buttons come back visible with it — so hiding them once at startup is not
 * enough, and the moment it goes wrong is the moment somebody is looking at the
 * top of the window. Failure is ignored: the cost is three buttons appearing,
 * which is not worth an error line.
 */
export const rehideNativeButtons = () =>
  void invoke('hide_traffic_lights').catch(() => {});
