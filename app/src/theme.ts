import { getCurrentWindow } from '@tauri-apps/api/window';

/**
 * Theme, three-way.
 *
 * "System" is a real third state, not the absence of a choice: it means follow
 * the OS *and keep following it* when the OS changes at sunset. So the stored
 * value is 'system', and no `data-theme` attribute is stamped at all — CSS then
 * resolves through `prefers-color-scheme` on its own, and a live listener is
 * only needed to repaint anything JS-side.
 *
 * `src/rtl.ts` is this module's sibling on the other axis: one attribute on the
 * document element, stamped before the first paint from `main.tsx` and kept in
 * step by a watcher, deciding how the whole stylesheet resolves. If you are
 * adding a third thing of this shape, it goes in a module of its own beside
 * these two rather than into either of them.
 */

export type Theme = 'light' | 'dark' | 'system';

const KEY = 'vylo.theme';

export function storedTheme(): Theme {
  const v = localStorage.getItem(KEY);
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}

/** What the theme resolves to right now, for anything that needs the concrete value. */
export function resolved(theme: Theme): 'light' | 'dark' {
  if (theme !== 'system') return theme;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
  // Native scrollbars and form controls follow this rather than our tokens.
  root.style.colorScheme = resolved(theme);

  // Keep the OS window chrome in step, so the traffic lights and the title bar
  // are not a light strip above a dark app.
  void getCurrentWindow()
    .setTheme(theme === 'system' ? null : theme)
    .catch(() => { /* older webview or unsupported platform */ });
}

export function storeTheme(theme: Theme): void {
  try { localStorage.setItem(KEY, theme); } catch { /* private mode */ }
}

/** Repaint on OS change, but only while the user is actually following it. */
export function watchSystem(get: () => Theme, onChange: () => void): () => void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  const handler = () => { if (get() === 'system') onChange(); };
  mq.addEventListener('change', handler);
  return () => mq.removeEventListener('change', handler);
}

export async function toggleFullscreen(): Promise<boolean> {
  const w = getCurrentWindow();
  const now = await w.isFullscreen();
  await w.setFullscreen(!now);
  return !now;
}

export async function isFullscreen(): Promise<boolean> {
  try { return await getCurrentWindow().isFullscreen(); } catch { return false; }
}
