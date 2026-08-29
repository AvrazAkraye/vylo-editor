/**
 * Errors, said properly.
 *
 * Every failure in the app used to reach the transcript as `String(e)`. That
 * gives the detail and loses the two things a person actually needs: what was
 * being attempted, and what to do now. "workspace root is unreadable: No such
 * file or directory" is accurate and useless — it does not say whether a commit,
 * a save or a checkpoint restore just failed.
 *
 * So each call site names what it was doing, and the known failures carry the
 * next step. The guidance is deliberately specific; "something went wrong,
 * please try again" is the thing this exists to avoid.
 */

/** A recognisable failure, and what to do about it. */
const ADVICE: { when: RegExp; then: string }[] = [
  { when: /changed on disk/i, then: 'Reload the file and try again.' },
  { when: /workspace root is unreadable/i, then: 'The folder may have been moved or deleted — open it again.' },
  { when: /escapes the (workspace|open folder)|outside the open folder/i, then: 'Only files inside the open folder can be reached.' },
  { when: /not valid UTF-8|binary/i, then: 'This looks like a binary file rather than text.' },
  { when: /exceeds the .* read limit|too large/i, then: 'Ask the agent to read part of it, or open it in the editor.' },
  { when: /rejected the API key|authentication_error|invalid api key/i, then: 'Check the key in Settings.' },
  { when: /rate limit/i, then: 'Wait a moment, or check your plan at chat.vylo-tech.com.' },
  { when: /no active subscription/i, then: 'Choose a plan at chat.vylo-tech.com.' },
  { when: /is not running/i, then: 'Enable it in Settings first.' },
  { when: /did not answer/i, then: 'The server may have failed to start — check its command in Settings.' },
  { when: /old_string not found/i, then: 'The file has changed since it was read; ask the agent to read it again.' },
  { when: /appears \d+ times/i, then: 'The agent needs a longer, unique anchor for that edit.' },
  { when: /permission denied/i, then: 'Check the file permissions.' },
  { when: /no such file|not found/i, then: 'It may have been deleted or renamed since it was listed.' },
  { when: /nothing to commit|no changes added/i, then: 'Approve some changes first.' },
  { when: /not a git repository/i, then: 'This folder is not a git repository.' },
];

/** The message out of whatever was thrown. */
export function detailOf(e: unknown): string {
  if (e === null || e === undefined) return 'Unknown error.';
  if (e instanceof Error) return e.message || String(e);
  if (typeof e === 'string') return e;
  if (typeof e === 'object' && 'message' in e && typeof (e as { message: unknown }).message === 'string') {
    return (e as { message: string }).message;
  }
  return String(e);
}

function tidy(text: string): string {
  let s = text.trim().replace(/\s+/g, ' ');
  if (!s) return 'Unknown error.';
  s = s[0].toUpperCase() + s.slice(1);
  if (!/[.!?]$/.test(s)) s += '.';
  return s;
}

/**
 * `doing` is an infinitive phrase — "save src/App.tsx", "commit", "start that
 * server" — so the result reads as a sentence.
 *
 * A detail that already begins with "Could not" is left to speak for itself
 * rather than being prefixed into "Could not send the message. Could not reach
 * the gateway…", which says it twice and reads like a stutter.
 */
export function explain(e: unknown, doing: string): string {
  const detail = tidy(detailOf(e));
  const advice = ADVICE.find((a) => a.when.test(detail))?.then;

  const head = /^(could not|couldn't|cannot|unable to)\b/i.test(detail)
    ? detail
    : `Could not ${doing}. ${detail}`;

  // Guidance the message already gives is not worth repeating.
  if (advice && !detail.toLowerCase().includes(advice.slice(0, 14).toLowerCase())) {
    return `${head} ${advice}`;
  }
  return head;
}
