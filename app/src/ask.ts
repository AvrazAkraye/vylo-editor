/**
 * Asking the person a question, in a webview that cannot.
 *
 * ## The bug this exists for
 *
 * `window.prompt` and `window.confirm` do nothing here. WKWebView routes all
 * three JavaScript dialogs through its `WKUIDelegate`, and wry's delegate
 * implements none of them — so `prompt()` returns `null` and `confirm()`
 * returns `false`, every time, with no error and nothing on screen.
 *
 * Thirteen actions were built on them: New file, New folder, Rename, New
 * branch, rename a chat, rename a terminal, and every confirm in front of
 * something destructive. The prompts silently did nothing. The confirms
 * silently answered *no*, which is the safe direction and is why this survived
 * so long — a delete that never happens looks like a delete you did not press
 * hard enough.
 *
 * ## Why a module and not a component
 *
 * The call sites read `const name = window.prompt(…)`: a question asked in the
 * middle of a function, answered before the next line. Threading a component
 * and a callback through six files would have rewritten all thirteen into
 * something harder to read than what they replaced.
 *
 * So this keeps the shape and changes only the wait:
 *
 *     const name = await ask.text({ title: 'Rename to', value: from });
 *     if (name === null) return;              // exactly as before
 *
 * One host renders whatever is pending. `null` is a cancel, as it always was.
 */

export interface TextAsk {
  kind: 'text';
  title: string;
  /** Prefilled, and selected when the field opens. */
  value: string;
  placeholder?: string;
  confirmLabel?: string;
  /** An empty answer is an answer: the confirm button stays live with nothing typed. */
  optional?: boolean;
}

export interface ConfirmAsk {
  kind: 'confirm';
  title: string;
  /** The detail under the title. A path, a command, a list of what goes. */
  body?: string;
  confirmLabel?: string;
  /** Red rather than accent, for something that cannot be undone. */
  danger?: boolean;
}

export type Ask = TextAsk | ConfirmAsk;

/** What is on screen now, with the promise it will settle. */
export interface Pending {
  ask: Ask;
  settle: (answer: string | boolean | null) => void;
}

type Listener = (pending: Pending | null) => void;

let current: Pending | null = null;
const listeners = new Set<Listener>();

function announce() {
  for (const l of listeners) l(current);
}

/** The host subscribes; everything else asks. */
export function subscribe(l: Listener): () => void {
  listeners.add(l);
  l(current);
  return () => { listeners.delete(l); };
}

export const pending = () => current;

/**
 * Ask, and wait.
 *
 * A second question while one is open answers the first as a cancel rather than
 * stacking. Two modals is never what somebody meant, and silently dropping the
 * second would leave whoever awaited it waiting for ever — a hang is worse than
 * a cancel, because a cancel is a thing the caller already handles.
 */
function open(ask: Ask): Promise<string | boolean | null> {
  if (current) {
    current.settle(ask.kind === 'confirm' ? false : null);
  }
  return new Promise((resolve) => {
    current = {
      ask,
      settle: (answer) => {
        // Only the question still on screen may settle. A late click from a
        // dialog that was replaced would otherwise answer the new one.
        if (current?.settle !== settleGuard) return;
        current = null;
        announce();
        resolve(answer);
      },
    };
    const settleGuard = current.settle;
    announce();
  });
}

/** A line of text, or `null` when it was cancelled. */
export async function text(a: Omit<TextAsk, 'kind'>): Promise<string | null> {
  const answer = await open({ kind: 'text', ...a });
  return typeof answer === 'string' ? answer : null;
}

/** True only when somebody actually said yes. */
export async function confirm(a: Omit<ConfirmAsk, 'kind'>): Promise<boolean> {
  return await open({ kind: 'confirm', ...a }) === true;
}

/** Close whatever is open, as a cancel. For Escape, and for a folder change. */
export function dismiss() {
  current?.settle(current.ask.kind === 'confirm' ? false : null);
}
