import { getCurrentWindow, UserAttentionType } from '@tauri-apps/api/window';
import {
  isPermissionGranted, requestPermission, sendNotification,
} from '@tauri-apps/plugin-notification';

/**
 * Telling somebody the agent is waiting for them, and telling them nothing else.
 *
 * A twelve-hop turn takes minutes, so people tab away — and the app then sits
 * on a modal approval dialog with the agent loop suspended on a promise, doing
 * nothing, until somebody happens to look back. Every minute of that is dead
 * time created by the product's own core mechanic. An agent that just runs
 * commands does not have this problem; ours does, because it asks.
 *
 * ## The notification is a summons, not a decision surface
 *
 * No Approve action on it, and no model-authored text in the body — never the
 * proposed command. A banner that can approve a shell command from the
 * notification centre is a decision taken without the string on screen, which
 * is the invariant broken by convenience. It focuses the window; the existing
 * dialog is what the human reads.
 *
 * That is built rather than remembered, in three places at once:
 *
 * - [`SENTENCES`] is the closed set of things a banner may say. Every one of
 *   them is written here and translated like any other UI string, and it is
 *   derived from the table below rather than listed twice, so it cannot drift
 *   away from what [`summons`] actually returns.
 * - [`Moment`] has no field a command, a file's contents or a sentence the
 *   model wrote could arrive in. There is nothing to sanitise because there is
 *   nothing to pass.
 * - `capabilities/default.json` grants the notification plugin exactly
 *   `is-permission-granted`, `request-permission` and `notify`, and withholds
 *   `register-action-types` and `register-listener` — which is what a button on
 *   the banner and a handler for it would need. `notification:default` would
 *   have granted both.
 *
 * ## Only while the window is in the background
 *
 * A banner drawn over the dialog it is about is noise, and an app that
 * notifies you about the thing you are looking at is an app people silence
 * within a day. So focus is the first thing [`summons`] reads, before the
 * settings and before the moment: focused means nothing fires, whatever else
 * is true.
 *
 * ## What the levels mean
 *
 * `needed` — the default — is the two moments where a person is genuinely
 * being waited for: an approval dialog has opened, or changes are staged in the
 * review pane. `all` adds the turn simply ending, which is news rather than a
 * decision. `off` is the one switch that stops the lot, sound included.
 *
 * Sound is off by default and deliberately a separate switch. The reason to
 * want a notification here is that you are in another window; the reason to
 * refuse one is that you are in a meeting, and those are different answers.
 */

/** The moments that need a human. Nothing else raises anything. */
export type Kind = 'approval' | 'staged' | 'finished' | 'failed';

/**
 * What happened.
 *
 * Deliberately this small. There is no `command`, no `path` and no `text`
 * field, because a body assembled from one of those is the notification centre
 * quoting the model — see the header.
 *
 * Stopping is *not* a moment. Stop is a button in this window, so whoever
 * pressed it was looking at the app a moment ago, and telling them what they
 * just asked for has happened is the sort of notification that teaches people
 * to turn notifications off.
 */
export interface Moment {
  kind: Kind;
  /** True when the approval is for an MCP tool rather than a shell command. */
  mcp?: boolean;
}

/** One banner, ready to be shown. Every string is an English `t()` key. */
export interface Summons {
  title: string;
  body: string;
  /** Play the platform's alert sound with it. */
  sound: boolean;
  /**
   * Dock bounce on macOS, taskbar flash on Windows.
   *
   * `critical` goes on until the app is brought forward, and is only honest
   * when the app is genuinely stuck — which of these moments only the approval
   * dialog is: the loop is suspended on a promise nothing but a click resolves.
   */
  attention: 'critical' | 'informational';
}

/** How loudly, and about what. */
export type Level = 'needed' | 'all' | 'off';

export interface Prefs {
  level: Level;
  sound: boolean;
}

/**
 * On for what needs a human, off for sound.
 *
 * A notification about an approval is the whole reason this exists, so it is on
 * without being asked for. A sound is not: an app that makes a noise on the
 * first day before anyone has decided it should is one people mute, and a muted
 * app has lost the approval banner too.
 */
export const DEFAULT: Prefs = { level: 'needed', sound: false };

/** In the order the Settings list offers them. */
export const LEVELS: readonly Level[] = ['needed', 'all', 'off'];

export const KEY = 'vylo.notify';
export const SOUND_KEY = 'vylo.notifysound';

/**
 * What each moment says, and the only place a notification's words come from.
 *
 * The titles repeat across moments on purpose: macOS and Windows both put the
 * application's own name above the title, so a title that says "Vylo" spends
 * the one line people read on something already on screen.
 */
const SAYS: Record<Kind, Omit<Summons, 'sound'>> = {
  approval: {
    title: 'Waiting for you',
    body: 'A command needs your approval before it can run.',
    attention: 'critical',
  },
  staged: {
    title: 'Waiting for you',
    body: 'Changes are staged and waiting in the review pane.',
    attention: 'informational',
  },
  finished: {
    title: 'Turn finished',
    body: 'The agent has finished its turn.',
    attention: 'informational',
  },
  failed: {
    title: 'Turn failed',
    body: 'The turn ended with an error.',
    attention: 'informational',
  },
};

/**
 * The one variation, and the reason it is worth having: an MCP tool call goes
 * through the same dialog as a shell command, and which of the two is waiting
 * is the difference between "go and look" and knowing whether it is worth it.
 * It names the *kind* of thing, never the thing.
 */
const MCP_BODY = 'An MCP tool needs your approval before it can run.';

/**
 * Every sentence a banner can carry.
 *
 * Derived from the table rather than written out again, so a fifth moment added
 * below cannot be tested against a list that has not heard of it. `summons()`
 * returning anything outside this set is the failure the test is looking for.
 */
export const SENTENCES: readonly string[] = [...new Set(
  Object.values(SAYS).flatMap((s) => [s.title, s.body]).concat(MCP_BODY),
)];

/**
 * The banner this moment deserves, or null when nothing should fire.
 *
 * Three inputs and no state, because every argument about whether a
 * notification was right to appear is an argument about exactly these three.
 */
export function summons(m: Moment, focused: boolean, prefs: Prefs): Summons | null {
  // First, and before the settings are even read. The window is in front, so
  // whatever this is about is already on screen.
  if (focused) return null;
  if (prefs.level === 'off') return null;
  // `needed` is the moments somebody is being waited for. A turn that merely
  // ended is news, and news that interrupts is what people switch off.
  if (prefs.level === 'needed' && m.kind !== 'approval' && m.kind !== 'staged') return null;

  // A kind that is not in the table is a kind nothing here knows how to phrase.
  // Silence beats an empty banner, and this is reachable: the caller is
  // JavaScript at runtime whatever the types say here.
  const says = SAYS[m.kind];
  if (!says) return null;

  return {
    title: says.title,
    body: m.kind === 'approval' && m.mcp ? MCP_BODY : says.body,
    attention: says.attention,
    sound: prefs.sound,
  };
}

/** How long one kind of summons stays quiet after it has been raised. */
export const QUIET_MS = 20_000;

/**
 * Whether this kind may be raised again, `sinceLast` milliseconds after the
 * last one of its kind went out.
 *
 * A turn that writes six files stages them one at a time, so without this the
 * notification centre collects six identical banners for one decision — and a
 * feature whose whole job is to be worth looking at cannot also be the thing
 * that fills the tray.
 *
 * Approval is exempt, and that is not an oversight. Two commands in one turn
 * are two decisions with the loop suspended on each in turn, so the second
 * dialog is genuinely new however soon after the first it opens; suppressing it
 * would leave the app stuck with nothing having said so.
 */
export function again(kind: Kind, sinceLast: number): boolean {
  return kind === 'approval' || sinceLast >= QUIET_MS;
}

/** The parts of `localStorage` this needs, so a fake is three lines. */
export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * The stored settings, or the defaults.
 *
 * Validated rather than trusted, like every other stored value in the app: a
 * hand-edited `"loud"` is not a level, and the answer to a value nobody wrote
 * through the UI is the default rather than a crash or a silent off.
 */
export function loadPrefs(store: Store): Prefs {
  try {
    const level = store.getItem(KEY);
    return {
      level: (LEVELS as readonly string[]).includes(level ?? '') ? (level as Level) : DEFAULT.level,
      // Anything that is not exactly '1' is off, which is also what an absent
      // value means — so the default survives a store that has never been
      // written to.
      sound: store.getItem(SOUND_KEY) === '1',
    };
  } catch {
    // Private mode, or storage disabled. Defaults, not silence: the approval
    // banner is the one thing here that is worth having by default.
    return { ...DEFAULT };
  }
}

export function savePrefs(store: Store, p: Prefs): void {
  try {
    store.setItem(KEY, p.level);
    store.setItem(SOUND_KEY, p.sound ? '1' : '0');
  } catch { /* private mode, or storage disabled */ }
}

/**
 * The alert sound's name, which is a different vocabulary on every platform.
 *
 * macOS wants a file in `/System/Library/Sounds`; Windows wants one of the
 * toast sound names. There is no value that means "the usual one" on both, so
 * this is the one place the platform has to be known. When the OS does not
 * recognise the name it plays nothing, which is the same as the default.
 */
function alertSound(mac: boolean): string {
  return mac ? 'Ping' : 'Default';
}

/**
 * Whether this app may post notifications, asked once.
 *
 * The desktop side of the plugin answers `Granted` unconditionally, so this is
 * a round trip that is always going to say yes — but it is the same call that
 * genuinely asks on the platforms where it matters, and caching it keeps the
 * cost at one IPC hop for the life of the window rather than two per banner.
 */
let granted: boolean | null = null;

/**
 * Show it, and ask the dock or the taskbar for attention.
 *
 * `say` is the caller's translator: the words are English keys here and
 * catalogue entries there, exactly as `shortcut.ts` hands back sentences for
 * `t()` rather than translating them itself.
 *
 * Neither half is allowed to take the other down. A machine where the user has
 * turned this app's notifications off at the OS level should still bounce its
 * dock icon, and a window that refuses to flash is not a reason to say nothing.
 */
export async function raise(
  s: Summons,
  say: (english: string) => string,
  mac: boolean,
): Promise<void> {
  try {
    if (granted === null) {
      granted = (await isPermissionGranted()) || (await requestPermission()) === 'granted';
    }
    if (granted) {
      sendNotification({
        title: say(s.title),
        body: say(s.body),
        // Left out rather than set to something silent: notify-rust plays
        // nothing when no name is given and plays the named sound when one is,
        // so the absence of the field *is* the off switch.
        ...(s.sound ? { sound: alertSound(mac) } : {}),
      });
    }
  } catch { /* notifications turned off for this app at the OS level */ }

  try {
    await getCurrentWindow().requestUserAttention(
      s.attention === 'critical' ? UserAttentionType.Critical : UserAttentionType.Informational,
    );
  } catch { /* no window manager attention to ask for */ }
}

/**
 * Keep `set` told whether the window is in front, and answer with the way to
 * stop listening.
 *
 * This is the window's own focus rather than the document's. `document.hasFocus()`
 * is a webview's opinion of itself and says nothing about the app being behind
 * three others, which is the only state this whole module cares about.
 *
 * Nothing reports the state at the moment you subscribe, so the caller starts
 * from "focused" — which is true of a window that has just been opened, and
 * wrong for at most one moment if it was not.
 */
export function watchFocus(set: (focused: boolean) => void): () => void {
  const stop = getCurrentWindow().onFocusChanged(({ payload }) => set(payload));
  return () => { void stop.then((off) => off()); };
}
