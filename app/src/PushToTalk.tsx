import { useEffect, useRef, useState } from 'react';
import { CHOICES, IDLE, equal, printable, reduce, type Setting, type State } from './ptt';

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

/** A field the person is typing into, whose keys are not ours to take. */
function editable(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName);
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
    const put = (next: State) => {
      if (equal(state.current, next)) return;
      state.current = next;
      setShown(next);
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
      if (CHOICES.some((c) => c.code === e.code) && !seen.current.has(e.code)) {
        seen.current.add(e.code);
        live.current.onKeyCodeSeen?.(e.code);
      }
      // A key held down repeats, and a repeat is not a second press. The
      // reducer folds them anyway (`held` says so), but only while it still
      // believes the key is down: the engine ending a session resets it — see
      // the sync effect below — and the next repeat would then read as a fresh
      // press and start a second one. Dropped here, at the edge, where the DOM
      // has already said which events are repeats.
      if (e.repeat) return;
      if (printable(e.code) && editable(e.target)) return;
      step('down', e.code);
    };
    const onUp = (e: KeyboardEvent) => {
      if (printable(e.code) && editable(e.target)) return;
      step('up', e.code);
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
