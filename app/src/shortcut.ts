import { invoke } from '@tauri-apps/api/core';

/**
 * The global shortcut — one chord, and nothing at all until somebody sets one.
 *
 * ## Off until it is set
 *
 * There is no default binding. A desktop app that silently claims a system-wide
 * chord is a bug in *somebody else's* software until they work out what took
 * it, and "what has stolen ⌘⇧Space" is an afternoon nobody asked to spend. So
 * the field starts empty, the Rust side registers nothing at launch, and
 * clearing the field genuinely gives the chord back.
 *
 * ## The physical key, not the character
 *
 * A chord is captured from `KeyboardEvent.code` — `KeyA`, `Digit1`, `Backquote`
 * — because that is what the OS registers a hotkey against, and it is what
 * `tauri-plugin-global-shortcut` parses. `key` is the wrong half of the event
 * twice over: on a Mac ⌥K arrives as `˚`, and on a French layout the key next to
 * the return key produces a different character from the American one while
 * being the same physical key underneath. Storing the character would give a
 * shortcut that moves when the layout does.
 *
 * ## What may be bound
 *
 * `KEYS` is the vocabulary, and it is deliberately narrower than what the
 * plugin will parse: every entry here is a key macOS and Windows can both
 * express as a hotkey, so the field never offers a chord the OS then refuses.
 * `summon.rs` lists the same names in its tests, which is what keeps the two
 * halves from drifting apart.
 *
 * A chord also needs a real modifier. `Shift+K` registered globally takes the
 * letter K away from every text field on the machine — including this app's own
 * composer — and the person it happens to has no way to know why.
 */

/** A key combination, as the OS sees it. */
export interface Chord {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** ⌘ on macOS, the Windows key elsewhere. `Super` in an accelerator. */
  meta: boolean;
  /** A `KeyboardEvent.code` value, and a key of `KEYS`. */
  code: string;
}

/** The parts of a keydown a chord is made of, so this runs without a DOM. */
export interface Press {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
}

/** What the window is told when the chord is pressed. `summon.rs` emits it. */
export const SUMMONED = 'vylo://summon';

/**
 * The keys a chord may end on, and how each is written for a person.
 *
 * The letters, digits and function keys are generated rather than listed: the
 * value is the label, and for those three families it is derivable, so writing
 * them out is 48 lines in which one typo would be invisible.
 */
const KEYS: Map<string, string> = (() => {
  const m = new Map<string, string>([
    ['Space', 'Space'], ['Enter', 'Enter'], ['Tab', 'Tab'], ['Escape', 'Esc'],
    ['Backspace', 'Backspace'], ['Delete', 'Delete'], ['Insert', 'Insert'],
    ['Home', 'Home'], ['End', 'End'], ['PageUp', 'Page Up'], ['PageDown', 'Page Down'],
    ['ArrowUp', '↑'], ['ArrowDown', '↓'], ['ArrowLeft', '←'], ['ArrowRight', '→'],
    ['Minus', '-'], ['Equal', '='], ['BracketLeft', '['], ['BracketRight', ']'],
    ['Backslash', '\\'], ['Semicolon', ';'], ['Quote', "'"], ['Backquote', '`'],
    ['Comma', ','], ['Period', '.'], ['Slash', '/'],
  ]);
  for (let i = 0; i < 26; i++) {
    const letter = String.fromCharCode(65 + i);
    m.set(`Key${letter}`, letter);
  }
  for (let d = 0; d <= 9; d++) m.set(`Digit${d}`, String(d));
  for (let f = 1; f <= 12; f++) m.set(`F${f}`, `F${f}`);
  return m;
})();

/**
 * The chord a keypress makes, or null while it is not one yet.
 *
 * Holding ⌘⇧ and nothing else is not a chord: `code` is then `MetaLeft`, which
 * is not in `KEYS`. That is what lets the field say "press a combination" and
 * keep saying it until a real key arrives, rather than binding ⌘ on its own.
 */
export function chordFrom(e: Press): Chord | null {
  if (!KEYS.has(e.code)) return null;
  return {
    ctrl: e.ctrlKey, alt: e.altKey, shift: e.shiftKey, meta: e.metaKey, code: e.code,
  };
}

/**
 * Escape alone leaves the field without binding anything.
 *
 * With a modifier it is an ordinary chord — ⌃Esc is a real thing to want — so
 * this is deliberately only the bare press, the way every other keybinding
 * recorder behaves.
 */
export function isCancel(e: Press): boolean {
  return e.code === 'Escape' && !e.ctrlKey && !e.altKey && !e.shiftKey && !e.metaKey;
}

/**
 * The string the Rust side parses.
 *
 * Modifiers first and in one fixed order, because two spellings of the same
 * chord would compare unequal and the settings field would look like it had
 * changed when it had not.
 */
export function accelerator(c: Chord): string {
  const parts: string[] = [];
  if (c.ctrl) parts.push('Control');
  if (c.alt) parts.push('Alt');
  if (c.shift) parts.push('Shift');
  if (c.meta) parts.push('Super');
  parts.push(c.code);
  return parts.join('+');
}

/** Modifier spellings accepted on the way back in, since the plugin takes them all. */
const MODS: Record<string, 'ctrl' | 'alt' | 'shift' | 'meta'> = {
  control: 'ctrl', ctrl: 'ctrl',
  alt: 'alt', option: 'alt',
  shift: 'shift',
  super: 'meta', command: 'meta', cmd: 'meta', meta: 'meta',
};

/**
 * Read an accelerator back.
 *
 * Liberal about spelling and case for the same reason the plugin is — a value
 * that came out of storage may have been written by hand — but strict about
 * shape: exactly one key, and it must be one of ours. `CmdOrCtrl` is
 * deliberately *not* accepted, because it means a different physical key on
 * each platform and a binding should say what was pressed.
 */
export function parse(accel: string): Chord | null {
  const tokens = accel.split('+').map((t) => t.trim());
  // An empty token means a stray or trailing separator; the plugin rejects
  // those too, and guessing what was meant is how a typo becomes a binding.
  if (tokens.some((t) => t.length === 0)) return null;
  const c: Chord = { ctrl: false, alt: false, shift: false, meta: false, code: '' };
  for (const token of tokens) {
    const mod = MODS[token.toLowerCase()];
    if (mod) { c[mod] = true; continue; }
    if (c.code) return null;
    const code = [...KEYS.keys()].find((k) => k.toLowerCase() === token.toLowerCase());
    if (!code) return null;
    c.code = code;
  }
  return c.code ? c : null;
}

/**
 * The chord as this platform writes it.
 *
 * macOS stacks the symbols in the order Apple does (⌃⌥⇧⌘) and Windows spells
 * the words out, because a ⌘ glyph on a machine with no such key is a puzzle.
 */
export function display(c: Chord, mac: boolean): string {
  const key = KEYS.get(c.code) ?? c.code;
  if (mac) {
    return `${c.ctrl ? '⌃' : ''}${c.alt ? '⌥' : ''}${c.shift ? '⇧' : ''}${c.meta ? '⌘' : ''}${key}`;
  }
  const parts: string[] = [];
  if (c.ctrl) parts.push('Ctrl');
  if (c.alt) parts.push('Alt');
  if (c.shift) parts.push('Shift');
  if (c.meta) parts.push('Win');
  parts.push(key);
  return parts.join('+');
}

/** A stored accelerator as this platform writes it, or '' if it is not one. */
export function label(accel: string, mac: boolean): string {
  const c = parse(accel);
  return c ? display(c, mac) : '';
}

/**
 * Why this chord cannot be the global shortcut, or null when it can.
 *
 * The sentences are English keys for `t()`; the caller translates them.
 */
export function problem(c: Chord): string | null {
  if (!KEYS.has(c.code)) return 'That key cannot be used in a global shortcut.';
  // Shift does not count. It is the one modifier people hold while typing.
  if (!c.ctrl && !c.alt && !c.meta) {
    return 'A global shortcut needs a modifier key, or it would take that key away from every other app.';
  }
  return null;
}

/**
 * What to tell someone when the OS refused the chord.
 *
 * Windows names the failure (`ERROR_HOTKEY_ALREADY_REGISTERED`); macOS only
 * says `RegisterEventHotKey failed`, which in practice means the same thing —
 * something else got there first. Neither sentence is a guess about *what*
 * owns it, because nothing on either platform will tell us.
 */
export function refusal(detail: string): string {
  if (/could not read|not a key combination|unknown (scancode|vkcode)|recognize|swallow/i.test(detail)) {
    return 'That key cannot be used in a global shortcut.';
  }
  if (/already registered|already in use|hotkey/i.test(detail)) {
    return 'Something else on this machine already uses that combination. Try a different one.';
  }
  return 'The system would not accept that combination. Try a different one.';
}

/** The parts of `localStorage` this needs, so a fake is three lines. */
export interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const KEY = 'vylo.summon';

/**
 * The stored binding, in canonical form, or null when there is none.
 *
 * Validated rather than trusted, like every other stored value in the app: what
 * comes back is only ever a chord the field itself could have produced, so a
 * hand-edited `"KeyA"` is ignored here instead of becoming a system-wide grab
 * of the letter A. `summon.rs` refuses it a second time, because a webview is
 * a place a determined person can reach.
 */
export function loadBinding(store: Store): string | null {
  let raw: string | null = null;
  try { raw = store.getItem(KEY); } catch { return null; }
  if (!raw) return null;
  const c = parse(raw);
  if (!c || problem(c)) return null;
  return accelerator(c);
}

/** Store `accel`, or forget the binding when it is null. */
export function saveBinding(store: Store, accel: string | null): void {
  try {
    if (accel) store.setItem(KEY, accel);
    else store.removeItem(KEY);
  } catch { /* private mode, or storage disabled */ }
}

/**
 * Register `accel` with the OS, or release the chord when it is null.
 *
 * Throws what the OS said when it refuses, which is what `refusal()` turns into
 * a sentence. Nothing is stored until this has returned.
 */
export async function bind(accel: string | null): Promise<void> {
  await invoke('set_global_shortcut', { accel });
}
