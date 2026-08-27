import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';

/**
 * Auto-update.
 *
 * The manifest and the artifacts are served by the Vylo gateway rather than
 * GitHub Releases: the repository is private, so release assets need a token,
 * and shipping a token inside the app to fetch its own updates is not a
 * credential you can rotate.
 *
 * Every artifact is signed with a key that never leaves the build machine, and
 * the public half is compiled into the app. That is what stops the update
 * channel from being a way to push arbitrary code onto someone's laptop if the
 * gateway is ever compromised: a tampered payload fails signature verification
 * and is discarded before it runs.
 */

export interface Available {
  version: string;
  notes: string;
  /** Download and install, then relaunch. Rejects if the signature fails. */
  install: (onProgress?: (pct: number | null) => void) => Promise<void>;
}

export async function checkForUpdate(): Promise<Available | null> {
  let update: Update | null = null;
  try {
    update = await check();
  } catch {
    // Offline, gateway down, or no manifest yet. An update check must never be
    // the reason the app shows an error on launch.
    return null;
  }
  if (!update) return null;

  return {
    version: update.version,
    notes: update.body || '',
    install: async (onProgress) => {
      let total = 0;
      let got = 0;
      await update.downloadAndInstall((e) => {
        if (e.event === 'Started') {
          total = e.data.contentLength || 0;
          onProgress?.(total ? 0 : null);
        } else if (e.event === 'Progress') {
          got += e.data.chunkLength;
          onProgress?.(total ? Math.min(100, Math.round((got / total) * 100)) : null);
        } else if (e.event === 'Finished') {
          onProgress?.(100);
        }
      });
      // The installer has been applied; the running process is now the old one.
      await relaunch();
    },
  };
}
