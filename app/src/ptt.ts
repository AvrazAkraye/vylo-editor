/**
 * Push-to-talk: hold a key and speak.
 *
 * BridgeMind's gesture. Hold Fn, say the question, let go, and it is sent. This
 * app already has dictation — `dictate.ts` opens the engine, folds its results
 * and puts the words into the composer at the caret — and this module adds
 * nothing to that pipeline. It decides one thing only: *when* a session starts
 * and when it ends, from the keys. Recognised text still travels the one road
 * it has always travelled, `Dictation.onText` into a textarea, and nothing here
 * ever sees a word of it. A reducer that reads key codes and a clock cannot be
 * turned into a voice command, which is the property `SAFETY.md` asks for.
 *
 * The model is a reducer over three inputs — a key going down, a key coming
 * up, and the window losing focus — with time passed in, so every rule below is
 * a table in the test file rather than a feeling about how it behaves.
 *
 * ## Hold or tap, decided by the release
 *
 * Two people want this and they want different things. One holds the key like
 * a radio handset and lets go when the sentence is over. The other has a
 * paragraph to say and does not want a finger pinned down for it, or cannot
 * hold a key at all. The same key serves both: a press that lasts longer than
 * `TAP_MS` was a hold, and a shorter one was a tap that leaves the session
 * running hands-free until the next tap. Only the release can tell them apart,
 * so that is where the decision is made.
 *
 * 250 ms is the threshold because it is where a press stops feeling like a
 * click. Shorter and a deliberate but slow tap would be read as a hold and
 * send on release; longer and a short hold — "yes" — would be read as a tap
 * and leave the microphone open.
 *
 * ## Start on the way down
 *
 * The session starts on `down`, before anybody knows whether it is a hold or
 * a tap. Waiting the 250 ms to find out would lose the first syllable of every
 * held sentence — the engine takes a moment to open, and people start talking
 * as they press. So both gestures start at once; the release decides only how
 * they end.
 *
 * ## Release sends, a tap does not
 *
 * Letting go of a held key is the deliberate end of a sentence with the words
 * still in mind, and BridgeMind sends on it; so does this (`stop`). A second
 * tap ends a hands-free session (`toggle`) and leaves the words where they
 * landed, in the composer, for the person to read and press Send — a paragraph
 * spoken over a minute is one worth a glance before it goes. The asymmetry is
 * on purpose, and the pill says which one is coming: "release to send" while
 * the key is down, "tap again to stop" once it is up.
 *
 * Sending means the same thing it means for the button: the message goes to
 * the model. It is not approval of anything. Every edit and every command the
 * model proposes afterwards still stops at the gate like any other.
 *
 * ## A chord is not a tap
 *
 * Every offered key is a modifier, and modifiers are chorded: someone who picks
 * Right Command still presses Cmd+S with it. A chord has two shapes and they
 * need different answers, because in one of them the session has already begun
 * and in the other it never should.
 *
 * *The chosen key first, the other one after.* The session started on the way
 * down as it must, so the moment another key goes down during the press the
 * press is marked as a chord, and its release *ends without sending* — the
 * `toggle` action — however long it lasted. Without this a slow Cmd+S would
 * send whatever was in the composer.
 *
 * *The other key first.* Then there was never an instant at which this looked
 * like a press meant for dictation, and opening a session in order to close it
 * again is worse than not opening one. Windows AltGr is exactly this shape: the
 * keyboard fires `ControlLeft` and then `AltRight` — the default key — for
 * every é and every €, so a start-then-stop would send the half-written
 * composer to the model because somebody typed an accent, and a quick AltGr tap
 * would leave the microphone open. So a `down` of the chosen key while any
 * other key is held is not a press at all: no `start`, no `toggle`, nothing on
 * the way down and nothing on its release, and a hands-free session already
 * running is left alone by it — that press was aimed at the keyboard layout,
 * not at the microphone, and the next unchorded tap still ends the session.
 *
 * `others` is what makes the difference sayable: the codes of non-chosen keys
 * currently down, kept from the same `down`s and `up`s the component already
 * forwards. A modifier let go *before* the chosen key arrives has left it, and
 * that press is an ordinary one. Blur empties it, because after a blur every
 * release lands on another window and a code stuck in there would block every
 * press for ever.
 *
 * Right Option is the default because it is the modifier fewest people chord
 * with; the header of the Settings row says to pick one you do not.
 *
 * Both marks are made in here, from keys that are not the chosen one, so they
 * can only be made for keys the component actually hands over. A listener that
 * drops keydowns before the reducer sees them — a letter typed into a field,
 * say — does not quieten the reducer, it blinds it: the press stays a hold and
 * its release sends. Which is the whole reason for `accept` below.
 *
 * ## Blur cancels a hold, not a hands-free session
 *
 * Cmd-Tab away with the key held and the `up` lands on another window; the
 * key would be held here for ever. So blur while held is a `cancel`: the
 * session ends and the words stay. A hands-free session is left alone by blur
 * — somebody who tapped to dictate and switched to a document to read from it
 * did that on purpose, and the engine's own silence timeout ends a session
 * nobody is speaking to.
 *
 * ## Repeats, other keys, a disabled setting
 *
 * A held key repeats `down`; only the first one counts (`held` says so). A key
 * that is not the chosen one starts nothing and ends nothing — its only effect
 * is the chord mark above. An `up` for a key never seen going down (pressed
 * before the window had focus, or before the setting was turned on) is
 * ignored. And a setting that is off produces no action for any input at all:
 * the keys are gated, not the session, and one already running is the mic
 * button's to end.
 *
 * ## The component decides nothing
 *
 * `PushToTalk.tsx` is two listeners and three callbacks, and every rule about
 * which key events matter lives here, in `accept`. Not for tidiness: a rule
 * that lives in the listener is a rule no test can reach. The reducer is
 * byte-identical whether or not a guard stands above the call to it, so a guard
 * put back there —
 *
 *     if (/^Key[A-Z]$/.test(e.code) && e.target instanceof HTMLTextAreaElement) return;
 *
 * — passes every test in this module while quietly breaking the chord mark
 * above. That guard existed once and did exactly that. So `accept` takes the
 * three things about a key event that this module cannot see for itself — the
 * code, whether the key is repeating, whether it landed in something editable —
 * and answers the only question the component is allowed to ask; the tests
 * state the answer for a printable key in a textarea, which is the case the
 * guard got wrong, and any future guard has to disagree with a test to exist.
 *
 * ## Which keys, and why Fn is offered but hidden
 *
 * Right Option, Right Control, Right Command, Fn. Right-hand modifiers because
 * the left ones carry every shortcut. Fn is BridgeMind's key and the one people
 * ask for, and it is offered — but macOS handles Fn below the event stream and
 * WKWebView delivers no `keydown` for it, so on most Macs choosing it would
 * choose a key that never fires. `supports` therefore hides Fn until a real
 * `keydown` with `code === 'Fn'` has been seen in this session; the component
 * reports every choice-key it sees for exactly that. A person on a keyboard
 * that does deliver it gets the option; nobody gets a dead one.
 *
 * ## Off by default
 *
 * A hidden hotkey that opens the microphone is not something to switch on for
 * somebody who has not asked. `DEFAULT` is off; the setting is the ask.
 */

export interface Setting {
  enabled: boolean;
  /** A `KeyboardEvent.code`. One of `CHOICES`, once it has been through `read`. */
  code: string;
}

/** Where the setting is kept. Versioned, so a future shape can be told apart. */
export const KEY = 'vylo.ptt.v1';

/** A press this long or longer is a hold; shorter is a tap. See the header. */
export const TAP_MS = 250;

export interface Choice {
  code: string;
  /** English, and the `i18n.ts` key. */
  label: string;
}

/** The keys a person can pick. The first is the default. */
export const CHOICES: readonly Choice[] = [
  { code: 'AltRight', label: 'Right Option' },
  { code: 'ControlRight', label: 'Right Control' },
  { code: 'MetaRight', label: 'Right Command' },
  { code: 'Fn', label: 'Fn' },
];

/** Off, on the key most people mean. */
export const DEFAULT: Setting = { enabled: false, code: 'AltRight' };

/** Keys the webview may never deliver; shown only once one has been seen. */
const UNPROVEN: ReadonlySet<string> = new Set(['Fn']);

// ── The keys ───────────────────────────────────────────────────────────────

/** Whether a code is one of the keys on offer. The one membership test. */
export function offered(code: string): boolean {
  return CHOICES.some((c) => c.code === code);
}

/** The English label for a code, or the code itself for one not on offer. */
export function labelOf(code: string): string {
  return CHOICES.find((c) => c.code === code)?.label ?? code;
}

/**
 * Whether a choice may be shown.
 *
 * Every offered key but Fn, always. Fn only once `seen` — the codes of
 * `keydown` events this session has actually received — includes it, for the
 * reason in the header. A code that is not a choice at all is never shown.
 */
export function supports(code: string, seen: readonly string[]): boolean {
  if (!offered(code)) return false;
  return !UNPROVEN.has(code) || seen.includes(code);
}

// ── Reading and writing the setting ────────────────────────────────────────

/**
 * Read the stored setting, repairing anything untrustworthy.
 *
 * The same posture as every other store in this app: a corrupt value is the
 * default, never a window that will not open. `enabled` is on only if it is
 * exactly `true` — the safe direction for a setting that opens a microphone —
 * and a code that is not one of `CHOICES` becomes the default key rather than
 * a key nothing could ever press.
 */
export function read(raw: string | null): Setting {
  try {
    const parsed = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ...DEFAULT };
    const s = parsed as Record<string, unknown>;
    const code = typeof s.code === 'string' && offered(s.code) ? s.code : DEFAULT.code;
    return { enabled: s.enabled === true, code };
  } catch {
    return { ...DEFAULT };
  }
}

/** What goes into storage. */
export function write(s: Setting): string {
  return JSON.stringify({ enabled: s.enabled, code: s.code });
}

// ── Describing the setting ─────────────────────────────────────────────────

/** A sentence key and what goes in its hole, for `fill(t(key), vars)`. */
export interface Phrase {
  key: string;
  vars: Record<string, string>;
}

/**
 * The setting as a sentence key.
 *
 * The key carries a `{key}` hole rather than the label, so a translator can
 * put the key's name where the language wants it; the label is its own
 * catalogue entry and the row translates it separately. Off is its own
 * sentence — "Hold Right Option to dictate" over a setting that is off would
 * be an instruction that does nothing.
 */
export function phrase(s: Setting): Phrase {
  if (!s.enabled) return { key: 'Push-to-talk is off', vars: {} };
  return { key: 'Hold {key} to dictate', vars: { key: labelOf(s.code) } };
}

/**
 * The setting as an English sentence: "Hold Right Option to dictate",
 * "Push-to-talk is off". The same substitution `i18n.fill` does, done here so
 * this module stays free of the dictionary.
 */
export function describe(s: Setting): string {
  const { key, vars } = phrase(s);
  let out = key;
  for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(v);
  return out;
}

// ── What reaches the reducer ───────────────────────────────────────────────

/** What the component knows about a key event and this module cannot see. */
export interface KeyEvent {
  /** The `KeyboardEvent.code`. */
  code: string;
  /** `KeyboardEvent.repeat`: the OS repeating a key that is already down. */
  repeat: boolean;
  /** It landed in a text field, a contenteditable, a terminal's textarea. */
  targetEditable: boolean;
}

/**
 * Whether a keydown or keyup should be folded in. The component's whole policy.
 *
 * Two noes and one loud yes.
 *
 * A repeat is not a second press. `reduce` folds repeats anyway (`held` says
 * so) — but only while it still believes the key is down, and the engine can
 * take that belief away mid-hold: eight seconds of silence ends the session,
 * the component resets the state, and the next repeat of a key that is still
 * physically held would read as a fresh press and start a second session. Once
 * that has happened only the DOM can still tell a repeat from a press, so the
 * answer has to be taken from the event, here.
 *
 * A setting that is off is no. `reduce` says so too and would be harmless, but
 * `others` is bookkeeping about held keys and there is no reason to accumulate
 * it for somebody who has not switched any of this on.
 *
 * And `targetEditable` is named, passed, and deliberately not consulted — a
 * printable key that lands in the composer, the editor or the terminal while
 * the chosen key is held is *precisely* the event the chord rule is made of,
 * and dropping it is what turned Right Option + O into a 600 ms hold that sent
 * the draft. It costs nothing to let through: `reduce` sees a code and a clock,
 * never calls `preventDefault`, and cannot — the letter types where it was
 * typed. The field is here so that the argument is in the type, and so that the
 * test that pins the yes has something to say no with.
 */
export function accept(ev: KeyEvent, setting: Setting): boolean {
  if (!setting.enabled) return false;
  if (ev.repeat) return false;
  return true;
}

// ── The reducer ────────────────────────────────────────────────────────────

export interface State {
  /** The chosen key is down. */
  held: boolean;
  /**
   * When the press that will send on release began — or null when releasing
   * will not send: no press, a hands-free session, or a press that turned
   * into a chord.
   */
  since: number | null;
  /** A session this layer started is running. */
  listening: boolean;
  /**
   * The codes of keys that are not the chosen one and are currently down. A
   * `down` of the chosen key while this is non-empty is a chord from its first
   * moment and not a press at all; see the header. Never mutated: every step
   * that changes it builds a new array.
   */
  others: readonly string[];
}

export const IDLE: State = { held: false, since: null, listening: false, others: [] };

export interface Input {
  type: 'down' | 'up' | 'blur';
  /** The `KeyboardEvent.code`. Ignored for a blur. */
  code: string;
  /** The clock, in milliseconds. Only differences are ever taken. */
  at: number;
}

/**
 * What the app should do.
 *
 * `start`  — open a session.
 * `stop`   — a held key was released: end the session and send.
 * `toggle` — a tap ended a hands-free session, or a chorded press was
 *            released: end the session, keep the words.
 * `cancel` — the window lost focus mid-hold: end the session, keep the words.
 */
export type Action = 'start' | 'stop' | 'cancel' | 'toggle' | null;

export interface Step {
  state: State;
  action: Action;
}

/**
 * Whether two states say the same thing *to the pill*. What decides if it
 * redraws.
 *
 * `others` is left out on purpose. It changes on every letter typed and the
 * pill says nothing about it, so comparing it would re-render the pill on every
 * keystroke to no visible end. The component keeps the reducer's latest state
 * in a ref regardless — this only decides whether React is told about it.
 */
export function equal(a: State, b: State): boolean {
  return a.held === b.held && a.since === b.since && a.listening === b.listening;
}

/**
 * Fold one input into the state and say what to do about it.
 *
 * Never reads the clock and never touches its arguments: the state that comes
 * back is always a new object, and the one that went in is as it was. The
 * rules are the header's; the shape of each case is "who is this key, and is
 * it already down".
 */
export function reduce(state: State, ev: Input, setting: Setting): Step {
  const same = (): Step => ({ state: { ...state }, action: null });
  if (!setting.enabled) return same();

  switch (ev.type) {
    case 'blur':
      // Every release now lands on another window, the chosen key's and the
      // others'. Forget them all: a code left in `others` would make every
      // later press a chord for ever.
      if (!state.held) return { state: { ...state, others: [] }, action: null };
      return { state: { ...IDLE }, action: state.listening ? 'cancel' : null };

    case 'down':
      if (ev.code !== setting.code) {
        // It is down, so a chosen key arriving after it is chorded from its
        // first moment. Idempotent: the DOM repeats keys.
        const others = state.others.includes(ev.code) ? state.others : [...state.others, ev.code];
        // And another key during a press is a chord, so that release must not
        // send. Nothing to mark once the press is already one that will not.
        const since = state.held && state.since !== null ? null : state.since;
        return { state: { ...state, since, others }, action: null };
      }
      // Something else is already down, so this was a chord before it began:
      // no session, and the `up` below finds no press to end. See the header.
      if (state.others.length > 0) return same();
      // A held key repeats. The first down was the press.
      if (state.held) return same();
      // A press during a hands-free session: it can only end it, so there is
      // no moment to send from. `since` stays null.
      if (state.listening) return { state: { ...state, held: true }, action: null };
      return { state: { held: true, since: ev.at, listening: true, others: state.others }, action: 'start' };

    case 'up': {
      // Braced: `rest` below is a declaration, and a declaration bare in a
      // `case` is scoped to the whole switch.
      if (ev.code !== setting.code) {
        // Up, so it can no longer make the next press a chord.
        if (!state.others.includes(ev.code)) return same();
        return { state: { ...state, others: state.others.filter((c) => c !== ev.code) }, action: null };
      }
      // No press to release: it was never pressed here, or its `down` was a
      // chord this reducer declined to call a press.
      if (!state.held) return same();
      // What is still down stays down: only the chosen key came up.
      const rest = { ...IDLE, others: state.others };
      // A press that will not send on release: the second tap of a hands-free
      // session, or a chord. Either way the session ends and the words stay.
      if (state.since === null) return { state: rest, action: state.listening ? 'toggle' : null };
      // A hold. A clock that cannot be trusted reads as a tap, which is the
      // direction in which nothing gets sent.
      if (ev.at - state.since >= TAP_MS) return { state: rest, action: state.listening ? 'stop' : null };
      // A tap: the session started on the way down carries on, hands-free.
      return { state: { ...rest, listening: state.listening }, action: null };
    }
  }
}
