import {
  CAP_WARN, DEFAULT_PACE, LIMITS, PACE_BOUNDS, type Campaign, type Draft, type Lang, type Pace, type Problem, type Recipient,
} from './whatsappbulktypes';
import type { Msg } from './whatsapp';

/**
 * Campaign arithmetic. PLACEHOLDER from Phase 0 (docs/WA.md): the `engine` package replaces this file
 * (variables and spintax, validation, pacing, estimates, opt-out words, the report). Names and signatures
 * below are the contract the screens are built against.
 */

/** The opt-out line, per language. */
export const OPT_OUT: Readonly<Record<Lang, string>> = {
  en: 'Reply STOP to stop receiving messages.',
  ar: 'للتوقف عن استلام الرسائل أرسل STOP.',
  ckb: 'بۆ وەستاندنی نامەکان STOP بنێرە.',
  kmr: 'بۆ ڕاوەستاندنا نامەیان STOP بھنێرە.',
};

/** The message for one person: variables filled, a choice made (by `seed`, so a preview is what is sent), the opt-out line added. */
export function renderMessage(d: Draft, r: Recipient, _seed = 0): string {
  return d.text.replace('{name}', r.name ?? '');
}

/** The variables a text asks for, by name, in order of first use. */
export function variablesIn(text: string): string[] {
  return [...text.matchAll(/\{([^{}|]+)(?:\|[^{}]*)?\}/g)].map((m) => m[1]);
}

/** Variables some recipients have no value for (and no fallback), with how many. */
export function missingVars(d: Draft, recipients: readonly Recipient[]): { name: string; missing: number }[] {
  return variablesIn(d.text).filter((n) => n !== 'name').map((name) => ({ name, missing: recipients.filter((r) => !r.vars[name]).length }));
}

/** Why this campaign cannot start yet; empty when it can. `sentToday` is what this account has already sent today. */
export function validateCampaign(c: Campaign, _o: { sentToday?: number } = {}): Problem[] {
  return c.recipients.length > LIMITS.recipients ? [{ code: 'too-many', vars: { n: c.recipients.length, max: LIMITS.recipients } }] : [];
}

/** A campaign, ready to be reviewed (state `draft`, nobody has consented yet). */
export function newCampaign(o: {
  name: string; accountId: string; recipients: Recipient[]; message: Draft; pace?: Pace; audienceId?: string; now?: number; id?: string; staged?: boolean;
}): Campaign {
  const now = o.now ?? Date.now();
  return {
    id: o.id ?? `c${now}`, name: o.name, accountId: o.accountId, audienceId: o.audienceId, recipients: o.recipients, message: o.message,
    pace: o.pace ?? { ...DEFAULT_PACE }, consent: false, state: 'draft', outcomes: {}, created: now, updated: now, staged: o.staged,
  };
}

/** Keep a pace inside the bounds the product allows; anything missing is the default. */
export function clampPace(p: Partial<Pace>): Pace {
  return { ...DEFAULT_PACE, ...p };
}

/** Whether a pace is inside the bounds the product allows. */
export function paceInBounds(p: Pace): boolean {
  return p.minDelaySec >= PACE_BOUNDS.minDelaySec[0] && p.dailyCap <= PACE_BOUNDS.dailyCap[1];
}

/** Whether a daily cap earns the plain warning. */
export function capWarning(p: Pace): boolean {
  return p.dailyCap > CAP_WARN;
}

/** About how long `people` messages take at this pace, in seconds, batch pauses included. */
export function estimateSeconds(people: number, pace: Pace = DEFAULT_PACE): number {
  return people * ((pace.minDelaySec + pace.maxDelaySec) / 2);
}

/** How many calendar days the cap spreads `people` messages over, given what was already sent today. */
export function daysNeeded(people: number, pace: Pace = DEFAULT_PACE, sentToday = 0): number {
  return Math.max(1, Math.ceil((people + sentToday) / pace.dailyCap));
}

/** Whether an incoming message is a request to stop. */
export function isOptOut(_text: string): boolean {
  return false;
}

/** The phones among `recipients` that sent a stop word in `msgs`. */
export function optOutPhones(_msgs: readonly Msg[], _recipients: ReadonlySet<string>): string[] {
  return [];
}

/** The campaign's report as CSV text (cells that could run as a formula are neutralised). */
export function reportCsv(c: Campaign): string {
  return ['phone,standing,why', ...Object.values(c.outcomes).map((o) => `${o.phone},${o.standing},${o.why ?? ''}`)].join('\n');
}
