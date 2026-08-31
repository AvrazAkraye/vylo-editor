import type { PlanSummary } from './account';

/**
 * The three decisions the sign-in wiring makes, stated once and asserted.
 *
 * `account.ts` knows how to talk to the account API. This is the layer above
 * it: what the *app* does with the answers. All of it lived as two `if`s and a
 * ternary inside `App.tsx` first, which is where it would have stayed if the
 * rules were obvious — but each of the three has a case that reads backwards
 * until it is written down, and two of them are about credentials:
 *
 *   `adopted`   which of the two secrets a finished setup replaces
 *   `signedOut` what signing out throws away, and what it must not
 *   `chip`      what the status bar says about a plan, and when it says nothing
 *
 * Pure, so all three are testable with no webview and no network, which is the
 * only way any of this is testable at all: the rest of the wiring is React and
 * this project has no component harness on purpose.
 */

/**
 * The two secrets the app holds.
 *
 * They are not interchangeable and they do not share a lifetime. `apiKey`
 * authenticates `/v1/messages` — the model. `token` authenticates
 * `/app/api` — the account. Everything below is about keeping the difference.
 */
export interface Secrets {
  /** `sk-vylo-…`. Pasted, or minted by a sign-in. */
  apiKey: string;
  /** The account session JWT. `''` when nobody is signed in. */
  token: string;
}

/**
 * What a finished setup does to what is already held.
 *
 * The rule is that **an empty half never overwrites a live one**, and both
 * empty halves are ordinary, expected outcomes rather than errors:
 *
 * - A **pasted key** arrives with no token. That person has no account on this
 *   gateway and may never want one — a self-hosted gateway need not even run
 *   the account API — so an empty token here must not sign anybody out.
 * - A **sign-in whose minting failed** arrives with no key. They *are* signed
 *   in: the token is real, `/me` will answer for them, and the plan balance is
 *   theirs. Only the key is missing, and clearing the key they already had
 *   would take a working app offline to report that a new key could not be
 *   made.
 *
 * The second is the one that reads backwards. The obvious `setApiKey(key)`
 * looks harmless right up to the moment somebody with a working key signs in
 * to see their balance and the mint 500s.
 */
export function adopted(have: Secrets, got: Secrets): Secrets {
  return {
    apiKey: got.apiKey || have.apiKey,
    token: got.token || have.token,
  };
}

/**
 * What signing out throws away.
 *
 * The token, and **not the key**. The key is a separate credential with its own
 * lifetime: it was minted for this machine, it goes on working, and nothing
 * about closing a session says anything about it. Clearing it here would revoke
 * a user's access to the model as a side effect of a button labelled *Sign
 * out*, which is a nasty surprise and not a security measure — the key is still
 * live on the server either way. Revoking it is a decision, and the keys page
 * is where it is made.
 */
export function signedOut(have: Secrets): Secrets {
  return { apiKey: have.apiKey, token: '' };
}

/** What the status bar draws after the plan's name. */
export type Tail =
  /** `left` tokens remain of a metered allowance. */
  | 'left'
  /** The plan has no ceiling. Says so; never draws a zero. */
  | 'no-limit'
  /** There is a name and nothing to say about a balance. */
  | 'none'
  /** The plan lapses in `days`, and that is scarcer than the tokens. */
  | 'days';

export interface Chip {
  /** The extra class on `.planm`, and `''` for the ordinary case. */
  level: '' | 'low' | 'out';
  /** The plan's name, or null when there is no plan to name. */
  name: string | null;
  tail: Tail;
  /**
   * Tokens left, already compact. **Non-null exactly when `tail` is `left`**,
   * which `chip` below enforces rather than merely intending — the renderer
   * interpolates this string, so a null reaching it prints the word `null`
   * where a balance should be.
   */
  left: string | null;
  /**
   * Whole days until the plan lapses. **Non-null exactly when `tail` is
   * `days`**, for the same reason `left` is: the renderer interpolates it.
   */
  days: number | null;
}

/**
 * The plan as a status-bar chip, or `null` for *say nothing*.
 *
 * Three cases decide this and only one of them is the normal one:
 *
 * - **`null` plan or `unknown` level — nothing is drawn.** "We could not tell"
 *   is not a figure, and a wrong figure about money is worse than no figure.
 *   This is also the whole of the majority path: somebody who pasted a key and
 *   never signed in has no plan object and must see a status bar that looks
 *   exactly as it did before this feature existed.
 * - **An unmetered plan says *no limit*.** `planSummary` reports `left: null`
 *   there, and a `left ?? 0` anywhere on this path would tell the customer
 *   paying the most that they had run out.
 * - **No subscription at all** keeps its own case: there is no name and no
 *   balance, so the chip carries the *No plan* label and no tail rather than a
 *   balance of zero, which would read as an allowance that had been spent.
 * - **A metered plan whose balance did not arrive says only its name.** There
 *   is a ceiling and no number for it: `remaining_tokens` was null and
 *   `monthly_tokens` was not a number either, so `planSummary` reports
 *   `metered: true` with `left: null`. Promising `left` there put the string
 *   `null` in the status bar where the balance goes. *No limit* would be the
 *   other wrong answer — this plan has one, it is just not known — so the name
 *   alone is what is true.
 */
/**
 * Whole days until a plan lapses, or null when it does not.
 *
 * Rounded *down*, so eleven hours left says 0 rather than 1. Generous rounding
 * is what lets somebody plan around a number that has in fact already run out.
 * MySQL hands back `2026-09-30 20:19:37` with no zone; the server keeps
 * everything in UTC, so that is what it is read as.
 */
export function daysLeft(renews: string | null, now: number): number | null {
  if (!renews) return null;
  const end = Date.parse(renews.includes('T') ? renews : `${renews.replace(' ', 'T')}Z`);
  if (Number.isNaN(end)) return null;
  return Math.max(0, Math.floor((end - now) / 86_400_000));
}

/**
 * A plan runs out two ways, and only one of them was ever shown.
 *
 * The token count has been in the status bar since 0.27.0. The *date* arrived
 * in the same response, was parsed into `renews`, and was never rendered — so
 * somebody on a fourteen-day trial with most of their tokens unspent saw a
 * comfortable number right up to the morning it stopped working. That is how
 * the owner found out: mid-turn, with a 402.
 *
 * Which of the two to show is decided by which is scarcer *as a fraction of
 * itself*. Twelve percent of the tokens with nine days left is a token problem;
 * eighty percent of the tokens with two days left is a calendar one. Showing
 * both needs twice the room in a bar that has none, and showing the wrong one
 * is worse than showing neither.
 */
export function chip(plan: PlanSummary | null, now = Date.now()): Chip | null {
  if (!plan || plan.level === 'unknown') return null;
  // A number is only claimed when there is one. `metered` says a ceiling
  // exists; `left` is the only thing that says what is under it, and the two
  // come apart when the server describes a plan by percentage alone.
  const counted = plan.metered && plan.left !== null;

  const days = daysLeft(plan.renews, now);
  // A week is where a renewal stops being background and becomes a thing to do
  // something about.
  const closing = days !== null && days <= 7;
  // `percent` is how much is *used*, so what remains is its complement. A
  // fortnight is the window a trial is measured against, which makes one day
  // a fourteenth of it.
  const tokenShare = plan.percent === null ? 1 : (100 - plan.percent) / 100;
  const dayShare = days === null ? 1 : Math.min(1, days / 14);
  const byDate = closing && dayShare < tokenShare;

  return {
    level: plan.level === 'low' ? 'low'
      : plan.level === 'out' ? 'out'
      : closing ? 'low' : '',
    name: plan.name,
    // A ceiling is the only thing worth a number. Without one there is either a
    // plan with no limit to report, or no plan at all.
    tail: byDate ? 'days'
      : counted ? 'left'
      : !plan.metered && plan.name ? 'no-limit'
      : 'none',
    left: !byDate && counted ? plan.left : null,
    days: byDate ? days : null,
  };
}
