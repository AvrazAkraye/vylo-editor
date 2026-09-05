import { useEffect, useRef, useState } from 'react';
import { IDLE, accept, equal, offered, reduce, type KeyEvent, type Setting, type State } from './ptt';

/**
 * The hold-a-key layer over dictation.
 *
 * No interface of its own beyond a pill while a session is running. Mounted
 * once, in App, beside the other window-wide things; it listens to the whole
 * window and tells the app when to start and stop the dictation it already
 * owns. Every decision is `ptt.ts`'s: this file turns DOM events into the
 * reducer's inputs and the reducer's actions into three callbacks, and draws
 * what the state says.
 *
 * ## Capture, on the window
 *
 * The editor, the terminal and the composer all stop propagation on keys they
 * handle, and a modifier pressed while the terminal has focus is exactly the
 * case that matters. Capture-phase listeners on `window` see every key before
 * any of them do. They never call `preventDefault`: a modifier on its own does
 * nothing by default, and a modifier in a chord must go on doing what the
 * chord means.
 *
 * ## Capture is for the keys, and nothing else
 *
 * `blur` was listened for the same way, and that was wrong. Focus events do not
 * bubble, so a capture-phase listener on `window` is the one way to hear *every
 * element inside the page* losing focus — and this app moves focus by itself
 * constantly: `onText` refocuses the composer after each finalised phrase, in
 * the middle of the very sentence the key is being held for. A hold started
 * with focus in the terminal or the editor was therefore cancelled by the app's
 * own focus move, mid-word, and the person watched their microphone close while
 * still speaking into it. Capture is right for keys — the editor and the
 * terminal stop propagation on theirs — and wrong for blur, which is not a
 * thing that gets stopped on the way up.
 *
 * So blur is heard on the bubble phase, where a non-bubbling event reaches
 * `window` only when `window` is the target, and the target is checked as well:
 * belt and braces for the one signal whose false positive cancels a sentence.
 * `visibilitychange` is the second signal, because a window hidden without a
 * blur — a space switch, the app being hidden — leaves the key held here just
 * as badly.
 *
 * ## No policy in here
 *
 * A guard used to stand at the top of `onDown` dropping any keydown whose code
 * types a character when it landed in a field somebody was typing into — and
 * it defeated the one rule it sat above. `ptt.ts` marks a press as a chord the
 * moment another key goes down during it, and that mark is made inside
 * `reduce`: a key this file never hands over is a key the reducer never sees.
 * So Right Option held in the composer while O typed "ø" was not a chord —
 * `since` stayed set, the release was longer than `TAP_MS`, and the half
 * written draft was sent to the model on the way up. The same hole covered the
 * terminal (xterm's hidden textarea is a field like any other) and the editor,
 * and it is the mechanism behind Windows AltGr, which fires
 * ControlLeft+AltRight and then types.
 *
 * Deleting that guard fixed it and pinned nothing: `reduce` behaves identically
 * whether or not a listener in this file feeds it, so the same guard written
 * again here would pass every test there is. So the rule moved rather than
 * went. `accept` in `ptt.ts` is the one thing that decides whether a key event
 * reaches the reducer, `factsOf` reports what the DOM knows and decides nothing,
 * and there is no `if` between them and `step`. A rule that wants to live here
 * has to be written in `ptt.ts` and argued in front of a test.
 *
 * ## Four actions, three callbacks
 *
 * From the app's side there are three outcomes: a session begins, a session
 * ends and its words are sent, a session ends and its words stay. The
 * reducer's `toggle` (a tap, or a chorded press, ending a session) and
 * `cancel` (a blur mid-hold) are both the third, so both land on `onCancel`.
 * Nothing in either path sends.
 *
 * ## The engine has the last word
 *
 * The reducer believes a session it started is running until it ends it. The
 * engine can end it first — eight seconds of silence, an error, a webview
 * with no engine at all — and a pill that says "Listening" over a closed
 * microphone is a lie. So the app passes the real phase as `listening`, and
 * when it goes off while the reducer still thinks otherwise, the reducer is
 * reset. Turning the setting off resets it the same way.
 *
 * ## What is reported, and how often
 *
 * `onKeyCodeSeen` exists so Settings can offer Fn only where it fires. It is
 * called for the offered keys only, once each per mount — not for every
 * keystroke — so the app can keep the answer in state without re-rendering
 * on every letter typed.
 */

interface Props {
  t: (s: string) => string;
  setting: Setting;
  /** Open a session. */
  onStart: () => void;
  /** A held key was released: end the session and send. */
  onStop: () => void;
  /** End the session and leave the words where they are. */
  onCancel: () => void;
  /** An offered key has been seen going down, so it is known to fire here. */
  onKeyCodeSeen?: (code: string) => void;
  /** The real session's phase, so the pill never outlives the engine. */
  listening?: boolean;
}

/**
 * What `accept` is given, read off the DOM event and nothing more. `repeat` and
 * the editability of the target are things `ptt.ts` cannot see for itself;
 * whether either of them matters is `accept`'s to say, not this function's.
 */
function factsOf(e: KeyboardEvent): KeyEvent {
  const el = e.target instanceof HTMLElement ? e.target : null;
  const targetEditable = !!el && (el.isContentEditable || el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement);
  return { code: e.code, repeat: e.repeat, targetEditable };
}

export function PushToTalk({ t, setting, onStart, onStop, onCancel, onKeyCodeSeen, listening }: Props) {
  // The reducer's state lives in a ref because the events arrive outside
  // React; `shown` mirrors it for the pill and changes only when it differs.
  const state = useRef<State>(IDLE);
  const [shown, setShown] = useState<State>(IDLE);
  // Callbacks and the setting through a ref, so the listeners — installed
  // once — always see the render's latest without being re-installed.
  const live = useRef({ setting, onStart, onStop, onCancel, onKeyCodeSeen });
  live.current = { setting, onStart, onStop, onCancel, onKeyCodeSeen };
  const seen = useRef(new Set<string>());

  useEffect(() => {
    // The ref is the reducer's state and always takes the newest one; `equal`
    // decides only whether React is told. They are not the same question:
    // `others` (which keys are down) changes on every letter typed and `equal`
    // does not look at it, so returning early on `equal` would throw that
    // bookkeeping away and every chord after the first letter would be missed.
    const put = (next: State) => {
      const redraw = !equal(state.current, next);
      state.current = next;
      if (redraw) setShown(next);
    };

    const step = (type: 'down' | 'up' | 'blur', code: string) => {
      const { state: next, action } = reduce(state.current, { type, code, at: Date.now() }, live.current.setting);
      // The app first, then the pill: on a start the engine's phase must be
      // set before the sync effect below can see a session it did not know
      // about and reset it. Batching makes that moot; the order makes it sure.
      switch (action) {
        case 'start': live.current.onStart(); break;
        case 'stop': live.current.onStop(); break;
        case 'toggle':
        case 'cancel': live.current.onCancel(); break;
        case null: break;
      }
      put(next);
    };

    const onDown = (e: KeyboardEvent) => {
      // Reported whatever the setting says: this is how Settings learns that Fn
      // fires here, and somebody choosing a key has not enabled anything yet.
      if (offered(e.code) && !seen.current.has(e.code)) {
        seen.current.add(e.code);
        live.current.onKeyCodeSeen?.(e.code);
      }
      if (accept(factsOf(e), live.current.setting)) step('down', e.code);
    };
    const onUp = (e: KeyboardEvent) => {
      if (accept(factsOf(e), live.current.setting)) step('up', e.code);
    };
    // The window, and not an element inside it. See the header.
    const onBlur = (e: FocusEvent) => { if (e.target === window) step('blur', ''); };
    const onHidden = () => { if (document.visibilityState === 'hidden') step('blur', ''); };

    window.addEventListener('keydown', onDown, true);
    window.addEventListener('keyup', onUp, true);
    window.addEventListener('blur', onBlur);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      window.removeEventListener('keydown', onDown, true);
      window.removeEventListener('keyup', onUp, true);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onHidden);
      // A microphone left open by a component that no longer exists is the
      // one failure nobody can see to fix.
      if (state.current.listening) live.current.onCancel();
      state.current = IDLE;
    };
  }, []);

  // The engine's word, and the setting's: either ends what the reducer
  // believes is running. See the header.
  useEffect(() => {
    if (setting.enabled && listening !== false) return;
    if (equal(state.current, IDLE)) return;
    state.current = IDLE;
    setShown(IDLE);
  }, [setting.enabled, listening, shown]);

  if (!shown.held && !shown.listening) return null;
  const holding = shown.held && shown.since !== null;
  return (
    <div className="ptt-pill" role="status" aria-live="polite">
      <span className="ptt-dot" aria-hidden="true" />
      {holding ? t('Listening — release to send') : t('Listening — tap again to stop')}
    </div>
  );
}

export default PushToTalk;
