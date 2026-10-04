import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { save as savePanel } from '@tauri-apps/plugin-dialog';
import { Icon } from './Icon';
import { fill, type Lang } from './i18n';
import { dateText, timeText } from './fmt';
import { detailOf } from './errors';
import { ready as connReady, type Account, type Msg } from './whatsapp';
import { maskPhone, normalisePhone } from './whatsappaudience';
import {
  capWarning, clampPace, daysNeeded, estimateSeconds, optOutPhones, renderMessage, reportCsv, validateCampaign,
} from './whatsappcampaign';
import { realDeps, runCampaign, sendTest, type Runner } from './whatsappsend';
import { saveCampaign } from './whatsappbulkstore';
import {
  CAP_WARN, DEFAULT_PACE, LIMITS, PACE_BOUNDS, type Campaign, type CampaignState, type Outcome, type Pace, type Problem,
  type Recipient, type RunEvent, type Standing,
} from './whatsappbulktypes';
import { Fill, Masked, num } from './WhatsAppPeople';
import { AttachmentLine, Bubble, draftOf, type MessageWork } from './WhatsAppCompose';

/**
 * Step 3 and after: Review & send, the live run, the report, the history and
 * the do-not-contact list (docs/WA.md, docs/wa/briefs/ui.md).
 *
 * ## The one place a campaign starts
 *
 * `launch` below is the only caller of `runCampaign` in the interface, and it
 * is reached from two buttons: **Send** on the review card, and **Continue** on
 * a campaign that a person already started with Send and that stopped (a halt,
 * or the app quitting mid-run). Both go through the same gate: consent ticked,
 * `validateCampaign` clean, and the campaign saved *before* the runner is made —
 * a campaign that cannot be kept is a campaign that cannot promise "at most
 * once", so it does not start. Nothing else here can send: the assistant's
 * staged drafts open on the review card and wait there like any other.
 *
 * ## The runner outlives the panel
 *
 * A broadcast of two hundred people takes hours, and closing the sidebar is
 * not "stop". The runner is held in this module, not in a component, so the
 * panel can close and open again and find it running; the screens subscribe to
 * it (`useLive`). A quit or a crash loses the runner but not the campaign:
 * WhatsAppBroadcast.tsx finds it still marked running, `recover`s it (every
 * send that may have gone becomes `unknown`, never retried by itself) and shows
 * it here as interrupted, with Continue.
 */

// ── the live run, held for the life of the window ────────────────────────

export interface Live {
  runner: Runner;
  campaign: Campaign;
  /** What the runner is waiting for, and until when; null while it is sending or after it ends. */
  wait: { until: number; why: 'delay' | 'batch' | 'daily-cap' } | null;
  /** `start()` has settled: the campaign is done, stopped or halted. */
  over: boolean;
  /** A runner that threw instead of halting (it promises not to), in words. */
  crash: string;
}

let live: Live | null = null;
const watchers = new Set<() => void>();
const tell = () => { for (const w of watchers) w(); };

/** The run this window holds, if any. */
export function liveRun(): Live | null {
  return live;
}

/** Be told when the run changes; returns the unsubscribe. */
export function watchLive(fn: () => void): () => void {
  watchers.add(fn);
  return () => { watchers.delete(fn); };
}

/** The live run, as React state. */
export function useLive(): Live | null {
  return useSyncExternalStore(watchLive, liveRun, liveRun);
}

/** Forget a finished run, so the screens go back to the steps. A running one is never forgotten. */
export function dismissRun(): void {
  if (live && !live.over) return;
  live = null;
  tell();
}

/** One event from the runner, applied to what the screens draw. Pure, so the test drives it. */
export function applyEvent(l: Live, e: RunEvent): Live {
  if (e.kind === 'state') {
    const waiting = e.campaign.state === 'running' || e.campaign.state === 'paused';
    return { ...l, campaign: e.campaign, wait: waiting ? l.wait : null };
  }
  return { ...l, wait: { until: e.until, why: e.why } };
}

/** Why `launch` refused, as a word the review turns into a sentence. */
export type LaunchRefusal = 'busy' | 'no-consent' | 'problems' | 'storage' | 'no-account' | 'other-account';

/**
 * Start (or continue) a campaign: the only call to `runCampaign` on any screen.
 *
 * Refuses while another run is live, without consent, with any problem
 * `validateCampaign` finds, without a ready account, and when the campaign
 * cannot be saved first. Returns at once; the run reports through `watchLive`.
 */
export async function launch(c: Campaign, account: Account | null, sentToday: number): Promise<LaunchRefusal | null> {
  if (live && !live.over) return 'busy';
  if (!account || !connReady(account)) return 'no-account';
  // A staged draft or an interrupted run of another number is never sent from the one on screen.
  if (account.id !== c.accountId) return 'other-account';
  if (c.consent !== true) return 'no-consent';
  if (validateCampaign(c, { sentToday }).length) return 'problems';
  const now = Date.now();
  const ready: Campaign = { ...c, state: c.state === 'draft' ? 'ready' : c.state, staged: false, updated: now };
  const kept = await saveCampaign(ready).catch(() => false);
  if (!kept) return 'storage';
  if (live && !live.over) return 'busy';
  const runner = runCampaign(ready, realDeps(account));
  const mine: Live = { runner, campaign: ready, wait: null, over: false, crash: '' };
  live = mine;
  runner.on((e) => {
    if (!live || live.runner !== runner) return;
    live = applyEvent(live, e);
    tell();
  });
  tell();
  void runner.start()
    .then((final) => { if (live && live.runner === runner) live = { ...live, campaign: final, wait: null, over: true }; })
    .catch((e) => { if (live && live.runner === runner) live = { ...live, wait: null, over: true, crash: detailOf(e) }; })
    .finally(tell);
  return null;
}

// ── counting ─────────────────────────────────────────────────────────────

export interface Counts {
  total: number; sent: number; failed: number; unknown: number; skipped: number; sending: number; queued: number;
}

const SKIPPED: readonly Standing[] = ['skipped-not-on-whatsapp', 'skipped-opted-out', 'skipped-invalid', 'skipped-duplicate'];

/**
 * Where a campaign stands, counted from its outcomes.
 *
 * A person with no outcome yet is queued: the runner may write outcomes as it
 * goes rather than all at the start, and "not touched" and "queued" are the
 * same thing to a person watching.
 */
export function countsOf(c: Campaign): Counts {
  const n: Counts = { total: c.recipients.length, sent: 0, failed: 0, unknown: 0, skipped: 0, sending: 0, queued: 0 };
  for (const r of c.recipients) {
    const s = c.outcomes[r.phone]?.standing ?? 'queued';
    if (s === 'sent') n.sent++;
    else if (s === 'failed') n.failed++;
    else if (s === 'unknown') n.unknown++;
    else if (s === 'sending') n.sending++;
    else if (SKIPPED.includes(s)) n.skipped++;
    else n.queued++;
  }
  return n;
}

/** How far along, 0 to 1: everyone with a standing other than waiting. */
export function progressOf(c: Campaign): number {
  const n = countsOf(c);
  return n.total ? (n.total - n.queued - n.sending) / n.total : 0;
}

/** The person being messaged now, if anyone. */
export function nowSending(c: Campaign): Recipient | null {
  return c.recipients.find((r) => c.outcomes[r.phone]?.standing === 'sending') ?? null;
}

/** The latest outcomes, newest first, for the live list. */
export function lastOutcomes(c: Campaign, n = 8): Outcome[] {
  return Object.values(c.outcomes)
    .filter((o) => o.standing !== 'queued' && o.standing !== 'sending')
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
    .slice(0, n);
}

/**
 * A campaign the window does not hold but that is stored as running was
 * interrupted — the app quit or crashed mid-send. Paused-by-the-person is not.
 */
export function interruptedOf(c: Campaign, held: Campaign | null): boolean {
  return c.state === 'running' && (!held || held.id !== c.id);
}

/** Over fifty people, Send asks for the count typed out: a slip of the finger is not a broadcast. */
export const CONFIRM_ABOVE = 50;
export const needsTyped = (n: number): boolean => n > CONFIRM_ABOVE;

/** Whether what was typed is the number of people, written any reasonable way. */
export function typedOk(typed: string, n: number): boolean {
  const digits = typed.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x6f0))
    .replace(/[\s,.'٬]/g, '');
  return /^\d+$/.test(digits) && Number(digits) === n;
}

/** The report's rows, filtered. */
export type ReportFilter = 'all' | 'sent' | 'failed' | 'unknown' | 'skipped';
export const REPORT_FILTERS: readonly ReportFilter[] = ['all', 'sent', 'failed', 'unknown', 'skipped'];

export function reportRows(c: Campaign, f: ReportFilter): { r: Recipient; o: Outcome | undefined }[] {
  return c.recipients.map((r) => ({ r, o: c.outcomes[r.phone] })).filter(({ o }) => {
    const s = o?.standing ?? 'queued';
    if (f === 'all') return true;
    if (f === 'skipped') return SKIPPED.includes(s);
    return s === f;
  });
}

// ── words ────────────────────────────────────────────────────────────────

/** "about 3 h 10 min". Whole sentences per shape, so each language can order its own. */
export function durationText(sec: number, t: (s: string) => string): string {
  const s = Math.max(0, Math.round(sec));
  if (s < 60) return t('under a minute');
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  if (h === 0) return fill(t('about {m} min'), { m });
  if (m === 0) return fill(t('about {h} h'), { h });
  return fill(t('about {h} h {m} min'), { h, m });
}

/** Why a campaign cannot start yet, in one sentence. */
export function problemText(p: Problem, t: (s: string) => string): string {
  const v = { n: num(Number(p.vars?.n ?? 0)), max: num(Number(p.vars?.max ?? LIMITS.recipients)) };
  if (p.code === 'no-recipients') return t('There is nobody to send to. Add people in step 1.');
  if (p.code === 'too-many') return fill(t('{n} people is more than one broadcast can hold ({max}).'), v);
  if (p.code === 'no-message') return t('The message is empty. Write something or attach a file.');
  if (p.code === 'message-too-long') return t('The message is too long for some people. Shorten it.');
  if (p.code === 'no-consent') return t('Tick the box to confirm everyone agreed to hear from you.');
  if (p.code === 'no-account') return t('Connect a WhatsApp account first.');
  if (p.code === 'attachment-too-big') return t('The attachment is larger than WhatsApp takes.');
  if (p.code === 'attachment-unreadable') return t('The attachment could not be read. Attach it again.');
  if (p.code === 'pace-out-of-bounds') return t('The pace is outside the safe range. Reset the pace.');
  if (p.code === 'over-daily-cap') return t('Today’s limit is already reached. Send tomorrow, or raise the daily limit.');
  return t('Another broadcast is sending now. Wait for it to finish.');
}

/** Why a run stopped by itself, and what to do about it. */
export function haltText(code: string, t: (s: string) => string): string {
  if (code === 'auth') return t('The WhatsApp server refused the key. Check the connection in settings.');
  if (code === 'not-connected') return t('This WhatsApp number is not connected. Link it again on the server, then continue.');
  if (code === 'rate-limited') return t('WhatsApp asked to slow down several times, so sending stopped. Wait an hour before continuing.');
  if (code === 'repeated-failures') return t('Several messages in a row failed, so sending stopped to protect your number. Check the connection, then continue.');
  if (code === 'account') return t('WhatsApp says this number is blocked or logged out. Do not continue until it is linked again.');
  if (code === 'storage') return t('The app could not save its progress, so it stopped before sending more. Free some disk space, then continue.');
  if (code === 'instance') return t('The WhatsApp server has no instance by that name. Check the connection in settings.');
  return t('Sending stopped by itself. Check the connection, then continue.');
}

/** What the runner is waiting for, said plainly. */
export function waitText(w: NonNullable<Live['wait']>, now: number, t: (s: string) => string): string {
  if (w.why === 'daily-cap') return fill(t('Today’s limit is reached. It continues tomorrow at {time}.'), { time: timeText(w.until) });
  if (w.why === 'batch') return fill(t('Taking a break until {time}.'), { time: timeText(w.until) });
  return fill(t('Next message in {s} s.'), { s: Math.max(0, Math.ceil((w.until - now) / 1000)) });
}

export function stateText(s: CampaignState, t: (s: string) => string): string {
  if (s === 'running') return t('Sending');
  if (s === 'paused') return t('Paused');
  if (s === 'done') return t('Finished');
  if (s === 'stopped') return t('Stopped');
  if (s === 'halted') return t('Stopped by itself');
  if (s === 'ready') return t('Starting…');
  return t('Draft');
}

export function standingText(s: Standing, t: (s: string) => string): string {
  if (s === 'sent') return t('Sent');
  if (s === 'failed') return t('Failed');
  if (s === 'unknown') return t('May or may not have been sent');
  if (s === 'sending') return t('Sending now');
  if (s === 'skipped-not-on-whatsapp') return t('Not on WhatsApp');
  if (s === 'skipped-opted-out') return t('Asked not to be messaged');
  if (s === 'skipped-invalid') return t('Not a valid number');
  if (s === 'skipped-duplicate') return t('Repeated');
  return t('Waiting');
}

const standingClass = (s: Standing): string =>
  s === 'sent' ? 'wa-bk-st is-sent' : s === 'failed' ? 'wa-bk-st is-failed' : s === 'unknown' ? 'wa-bk-st is-unknown' : 'wa-bk-st';

export function refusalText(r: LaunchRefusal, t: (s: string) => string): string {
  if (r === 'busy') return t('Another broadcast is sending now. Wait for it to finish.');
  if (r === 'no-consent') return t('Tick the box to confirm everyone agreed to hear from you.');
  if (r === 'no-account') return t('Connect a WhatsApp account first.');
  if (r === 'other-account') return t('This broadcast belongs to another WhatsApp account. Switch to that account first.');
  if (r === 'storage') return t('The broadcast could not be saved on this computer, so nothing was sent.');
  return t('Something on this card needs fixing first.');
}

// ── Review & send ────────────────────────────────────────────────────────

/** The number the person sends tests to, remembered across broadcasts (Start over keeps it). */
export const ME_KEY = 'vylo.whatsapp.bulk.me.v1';
export function readMe(raw: string | null): string {
  return typeof raw === 'string' && /^\d{6,15}$/.test(raw) ? raw : '';
}

export interface ReviewProps {
  t: (s: string) => string;
  account: Account | null;
  campaign: Campaign;
  msg: MessageWork;
  sentToday: number;
  country: string;
  onPace: (p: Pace) => void;
  onConsent: (yes: boolean) => void;
  /** Send. Resolves to a sentence when it was refused, or '' when the run started. */
  onSend: () => Promise<string>;
}

export function ReviewStep({ t, account, campaign, msg, sentToday, country, onPace, onConsent, onSend }: ReviewProps) {
  const [paceOpen, setPaceOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [bad, setBad] = useState('');
  const [me, setMe] = useState(() => { try { return readMe(localStorage.getItem(ME_KEY)); } catch { return ''; } });
  const [meText, setMeText] = useState(me ? `+${me}` : '');
  const [test, setTest] = useState<'' | 'sending' | 'sent' | string>('');
  const ids = useId();

  const n = campaign.recipients.length;
  const pace = campaign.pace;
  const problems = useMemo(() => validateCampaign(campaign, { sentToday }), [campaign, sentToday]);
  const first = campaign.recipients[0];
  const firstText = first ? renderMessage(draftOf(msg), first) : msg.text;
  const days = daysNeeded(n, pace, sentToday);
  const typedRight = !needsTyped(n) || typedOk(typed, n);
  const canSend = problems.length === 0 && typedRight && !busy;

  async function send() {
    if (!canSend) return;
    setBusy(true);
    setBad('');
    const why = await onSend();
    setBusy(false);
    if (why) setBad(why);
  }

  async function testIt() {
    if (!account || !first) return;
    const nmb = normalisePhone(meText, country);
    if (!('phone' in nmb)) { setTest(t('That phone number could not be read.')); return; }
    setMe(nmb.phone);
    try { localStorage.setItem(ME_KEY, nmb.phone); } catch { /* private mode */ }
    setTest('sending');
    try {
      const r = await sendTest(account, nmb.phone, firstText);
      setTest(r === 'sent' ? 'sent' : fill(t('The test was not sent: {why}'), { why: r.failed }));
    } catch (e) {
      setTest(fill(t('The test was not sent: {why}'), { why: detailOf(e) }));
    }
  }

  const setPace = (patch: Partial<Pace>) => onPace(clampPace({ ...pace, ...patch }));

  return (
    <section className="wa-bk-step" aria-labelledby={`${ids}-h`}>
      <h3 className="wa-bk-h" id={`${ids}-h`}>{t('Check it, then send')}</h3>
      {campaign.staged && (
        <p className="wa-bk-staged"><Icon name="sparkle" size={12} />{t('Prepared by the assistant. Nothing has been sent.')}</p>
      )}

      <dl className="wa-bk-review">
        <div className="wa-bk-rv">
          <dt>{t('To')}</dt>
          <dd>
            <span className="wa-bk-line">
              <Fill text={n === 1 ? t('{n} person') : t('{n} people')} parts={{ n: <b>{num(n)}</b> }} />
            </span>
            <span className="wa-bk-phones">
              {campaign.recipients.slice(0, 3).map((r) => <Masked key={r.phone} phone={r.phone} />)}
              {n > 3 && <span className="wa-bk-quiet">{fill(t('and {n} more'), { n: num(n - 3) })}</span>}
            </span>
          </dd>
        </div>
        <div className="wa-bk-rv">
          <dt>{t('From')}</dt>
          <dd>{account ? <bdi className="wa-bk-acct">{account.name}</bdi> : <span className="wa-bk-quiet">{t('No WhatsApp account is connected.')}</span>}</dd>
        </div>
        <div className="wa-bk-rv">
          <dt>{t('Message')}</dt>
          <dd>
            {first && <span className="wa-bk-quiet">{fill(t('Exactly as {name} will get it:'), { name: first.name || maskPhone(first.phone) })}</span>}
            <div className="wa-bk-wall is-small"><Bubble text={firstText} attachment={msg.attachment} t={t} /></div>
            <AttachmentLine a={msg.attachment} t={t} />
          </dd>
        </div>
        <div className="wa-bk-rv">
          <dt>{t('Pace')}</dt>
          <dd>
            <span className="wa-bk-line">{fill(t('About one message every {min}–{max} seconds, with a break every {batch}.'), { min: pace.minDelaySec, max: pace.maxDelaySec, batch: pace.batchSize })}</span>
            <span className="wa-bk-line">{fill(t('Sending takes {time} in all.'), { time: durationText(estimateSeconds(n, pace), t) })}</span>
            <span className="wa-bk-line">{fill(t('{cap} a day at most.'), { cap: num(pace.dailyCap) })}</span>
            {days > 1 && (
              <span className="wa-bk-warn">{fill(t('At {cap} a day this takes {days} days. Keep the app open: it continues each day by itself.'), { cap: num(pace.dailyCap), days })}</span>
            )}
            <button type="button" className="wa-bk-link" aria-expanded={paceOpen} aria-controls={`${ids}-pace`} onClick={() => setPaceOpen(!paceOpen)}>
              <Icon name="settings" size={11} />
              {paceOpen ? t('Hide the pace') : t('Change pace')}
            </button>
            {paceOpen && (
              <div className="wa-bk-pace" id={`${ids}-pace`}>
                <PaceField label={t('Shortest wait between messages (seconds)')} value={pace.minDelaySec} bounds={PACE_BOUNDS.minDelaySec}
                           onChange={(v) => setPace({ minDelaySec: v, maxDelaySec: Math.max(v, pace.maxDelaySec) })} />
                <PaceField label={t('Longest wait between messages (seconds)')} value={pace.maxDelaySec} bounds={PACE_BOUNDS.maxDelaySec}
                           onChange={(v) => setPace({ maxDelaySec: v })} />
                <PaceField label={t('Messages before a break')} value={pace.batchSize} bounds={PACE_BOUNDS.batchSize}
                           onChange={(v) => setPace({ batchSize: v })} />
                <PaceField label={t('Length of the break (seconds)')} value={pace.batchPauseSec} bounds={PACE_BOUNDS.batchPauseSec}
                           onChange={(v) => setPace({ batchPauseSec: v })} />
                <PaceField label={t('Most messages in one day')} value={pace.dailyCap} bounds={PACE_BOUNDS.dailyCap}
                           onChange={(v) => setPace({ dailyCap: v })} />
                <PaceField label={t('Stop after this many failures in a row')} value={pace.stopAfterFailures} bounds={PACE_BOUNDS.stopAfterFailures}
                           onChange={(v) => setPace({ stopAfterFailures: v })} />
                <label className="wa-bk-check">
                  <input type="checkbox" checked={pace.typing} onChange={(e) => setPace({ typing: e.target.checked })} />
                  <span>{t('Show “typing…” before each message')}</span>
                </label>
                {capWarning(pace) && (
                  <p className="wa-bk-warn">{fill(t('More than {n} a day makes it much more likely that WhatsApp blocks your number.'), { n: CAP_WARN })}</p>
                )}
                <button type="button" className="wa-bk-link" onClick={() => onPace({ ...DEFAULT_PACE })}>{t('Reset the pace')}</button>
              </div>
            )}
          </dd>
        </div>
      </dl>

      <label className="wa-bk-check wa-bk-consent">
        <input type="checkbox" checked={campaign.consent} onChange={(e) => onConsent(e.target.checked)} />
        <span>{t('Everyone on this list agreed to hear from me.')}</span>
      </label>

      {account && first && (
        <div className="wa-bk-test">
          <label className="wa-bk-field">
            <span>{t('Your own WhatsApp number, for a test')}</span>
            <input className="wa-bk-input" dir="ltr" inputMode="tel" value={meText} placeholder="+964 …"
                   onChange={(e) => { setMeText(e.target.value); if (test && test !== 'sending') setTest(''); }} />
          </label>
          <button type="button" className="wa-bk-btn" disabled={!meText.trim() || test === 'sending'} onClick={() => void testIt()}>
            <Icon name={test === 'sending' ? 'clock' : 'send'} size={13} />
            {test === 'sending' ? t('Sending the test…') : t('Send a test to myself')}
          </button>
          {msg.attachment && <p className="wa-bk-quiet">{t('The test carries the words only, not the attachment.')}</p>}
          {test === 'sent' && <p className="wa-bk-ok" role="status">{t('The test was sent. Check your phone.')}</p>}
          {test && test !== 'sent' && test !== 'sending' && <p className="wa-why" role="alert">{test}</p>}
        </div>
      )}

      {problems.length > 0 && (
        <ul className="wa-bk-notes" aria-live="polite">
          {problems.map((p) => <li key={p.code} className="is-block"><Icon name="warning" size={12} /><span>{problemText(p, t)}</span></li>)}
        </ul>
      )}

      {needsTyped(n) && (
        <label className="wa-bk-field">
          <span>{fill(t('To confirm, type the number of people: {n}'), { n: num(n) })}</span>
          <input className="wa-bk-input" dir="ltr" inputMode="numeric" value={typed} onChange={(e) => setTyped(e.target.value)}
                 aria-invalid={typed !== '' && !typedRight} />
        </label>
      )}

      <p className="wa-bk-fine">{t('WhatsApp can block numbers that message people who did not ask. Messages go slowly on purpose.')}</p>
      <button type="button" className="sb-cta-go wa-bk-go wa-bk-send" disabled={!canSend} onClick={() => void send()}>
        <Icon name={busy ? 'clock' : 'send'} size={14} />
        {n === 1 ? t('Send to 1 person') : fill(t('Send to {n} people'), { n: num(n) })}
      </button>
      {bad && <p className="wa-why" role="alert">{bad}</p>}
    </section>
  );
}

function PaceField({ label, value, bounds, onChange }: {
  label: string; value: number; bounds: readonly [number, number]; onChange: (v: number) => void;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => { setText(String(value)); }, [value]);
  return (
    <label className="wa-bk-field is-inline">
      <span>{label}</span>
      <input className="wa-bk-input wa-bk-num" type="number" dir="ltr" min={bounds[0]} max={bounds[1]} value={text}
             onChange={(e) => setText(e.target.value)}
             onBlur={() => { const v = Number(text); onChange(Number.isFinite(v) ? Math.min(bounds[1], Math.max(bounds[0], Math.round(v))) : value); }}
             onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
    </label>
  );
}

// ── the run ──────────────────────────────────────────────────────────────

export interface RunProps {
  t: (s: string) => string;
  /** The live run, or a stored campaign that is not running in this window (interrupted, halted, paused). */
  campaign: Campaign;
  run: Live | null;
  /** The app quit or crashed while this was sending. */
  interrupted: boolean;
  onContinue: () => void;
  onReport: () => void;
  onDone: () => void;
}

export function RunView({ t, campaign, run, interrupted, onContinue, onReport, onDone }: RunProps) {
  const [now, setNow] = useState(() => Date.now());
  const [stopping, setStopping] = useState(false);
  const c = run ? run.campaign : campaign;
  const counts = countsOf(c);
  const pct = Math.round(progressOf(c) * 100);
  const who = nowSending(c);
  const recent = lastOutcomes(c);
  const names = useMemo(() => new Map(c.recipients.map((r) => [r.phone, r.name ?? ''])), [c.recipients]);
  const ticking = !!run?.wait && run.wait.why === 'delay';
  useEffect(() => {
    if (!ticking) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [ticking]);
  const going = !!run && !run.over;
  const left = counts.queued + counts.sending;
  const ended = !going && (c.state === 'done' || c.state === 'stopped');
  const pauseBtn = useRef<HTMLButtonElement>(null);

  return (
    <section className="wa-bk-run" aria-label={t('Sending')}>
      <div className="wa-bk-ring" style={{ ['--p' as string]: `${pct}` }} role="progressbar" aria-valuemin={0} aria-valuemax={100}
           aria-valuenow={pct} aria-label={t('Progress')}>
        <span className="wa-bk-ring-in">
          <b>{pct}%</b>
          <small>{stateText(going ? c.state : interrupted ? 'paused' : c.state, t)}</small>
        </span>
      </div>
      <p className="wa-bk-sr" role="status" aria-live="polite">
        {fill(t('{sent} of {total} sent'), { sent: num(counts.sent), total: num(counts.total) })}
      </p>

      <ul className="wa-bk-counts">
        <li className="is-sent"><b>{num(counts.sent)}</b><span>{t('Sent')}</span></li>
        <li className="is-failed"><b>{num(counts.failed)}</b><span>{t('Failed')}</span></li>
        <li><b>{num(counts.skipped)}</b><span>{t('Skipped')}</span></li>
        <li className="is-unknown"><b>{num(counts.unknown)}</b><span>{t('Unsure')}</span></li>
      </ul>

      {going && who && (
        <p className="wa-bk-now">
          <Fill text={t('Sending to {who} now')} parts={{ who: who.name ? <bdi>{who.name}</bdi> : <Masked phone={who.phone} /> }} />
        </p>
      )}
      {going && run?.wait && c.state === 'running' && <p className="wa-bk-wait">{waitText(run.wait, now, t)}</p>}
      {interrupted && !going && (
        <p className="wa-bk-warn">{t('Paused: the app closed while it was sending. Nothing is sent twice when you continue.')}</p>
      )}
      {!going && c.state === 'halted' && <p className="wa-why" role="alert">{haltText(c.halted ?? '', t)}</p>}
      {run?.crash && <p className="wa-why" role="alert">{fill(t('Sending stopped because of an error: {why}'), { why: run.crash })}</p>}
      {counts.unknown > 0 && (
        <p className="wa-bk-quiet">{t('“Unsure” means the app lost touch with WhatsApp at the moment of sending. Those are never sent again by themselves.')}</p>
      )}

      <div className="wa-bk-acts wa-bk-runacts">
        {going && c.state === 'running' && (
          <button ref={pauseBtn} type="button" className="wa-bk-btn" onClick={() => run?.runner.pause()}>
            <Icon name="pause" size={13} />{t('Pause')}
          </button>
        )}
        {going && c.state === 'paused' && (
          <button type="button" className="sb-cta-go wa-bk-go" onClick={() => run?.runner.resume()}>
            <Icon name="play" size={13} />{t('Resume')}
          </button>
        )}
        {going && (
          <button type="button" className={stopping ? 'wa-bk-btn is-danger' : 'wa-bk-btn'}
                  onClick={() => { if (!stopping) { setStopping(true); return; } setStopping(false); run?.runner.stop(); }}
                  onBlur={() => setStopping(false)}>
            <Icon name="stop" size={13} />{stopping ? t('Press again to stop for good') : t('Stop')}
          </button>
        )}
        {!going && !ended && left > 0 && (
          <button type="button" className="sb-cta-go wa-bk-go" onClick={onContinue}>
            <Icon name="play" size={13} />{fill(t('Continue with the {n} left'), { n: num(left) })}
          </button>
        )}
        {!going && (
          <button type="button" className="wa-bk-btn" onClick={onReport}>
            <Icon name="clipboard" size={13} />{t('See the report')}
          </button>
        )}
        {ended && (
          <button type="button" className="wa-bk-btn is-quiet" onClick={onDone}>{t('New broadcast')}</button>
        )}
      </div>

      {recent.length > 0 && (
        <>
          <h4 className="wa-bk-sub">{t('Latest')}</h4>
          <ul className="wa-bk-feed">
            {recent.map((o) => (
              <li key={o.phone}>
                <span className="wa-bk-feed-who">{names.get(o.phone) ? <bdi>{names.get(o.phone)}</bdi> : <Masked phone={o.phone} />}</span>
                <span className={standingClass(o.standing)}>{standingText(o.standing, t)}</span>
                {o.at ? <time className="wa-bk-quiet">{timeText(o.at)}</time> : null}
              </li>
            ))}
          </ul>
        </>
      )}
      <p className="wa-bk-fine">{t('You can close this panel: sending goes on while the app is open.')}</p>
    </section>
  );
}

// ── the report ───────────────────────────────────────────────────────────

/** The phones on a campaign that replied with a stop word, from the chats the panel has loaded. */
export function stopRepliesFor(c: Campaign, msgs: readonly Msg[]): string[] {
  return optOutPhones(msgs, new Set(c.recipients.map((r) => r.phone)));
}

export interface ReportProps {
  t: (s: string) => string;
  lang: Lang;
  campaign: Campaign;
  msgs?: readonly Msg[];
  onAddSuppressed: (phones: string[]) => Promise<void>;
  onDuplicate: () => void;
  onDoNotContact: () => void;
}

/** A filter's name on its button. */
function filterName(f: ReportFilter, t: (s: string) => string): string {
  if (f === 'sent') return t('Sent');
  if (f === 'failed') return t('Failed');
  if (f === 'unknown') return t('Unsure');
  if (f === 'skipped') return t('Skipped');
  return t('All');
}

export function ReportView({ t, lang, campaign, msgs, onAddSuppressed, onDuplicate, onDoNotContact }: ReportProps) {
  const [filter, setFilter] = useState<ReportFilter>('all');
  const [said, setSaid] = useState('');
  const counts = countsOf(campaign);
  const rows = reportRows(campaign, filter);
  const ids = useId();

  async function csv() {
    setSaid('');
    try {
      const path = await savePanel({
        title: t('Save the report'),
        defaultPath: `${campaign.name.replace(/[\\/:*?"<>|\n]+/g, ' ').trim().slice(0, 60) || 'broadcast'}.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      });
      // Cancelling the save panel is an answer, not a failure.
      if (!path) return;
      await invoke('export_write', { path, text: reportCsv(campaign) });
      setSaid(t('The report was saved.'));
    } catch (e) {
      setSaid(fill(t('The report could not be saved: {why}'), { why: detailOf(e) }));
    }
  }

  async function stops() {
    if (!msgs || !msgs.length) { setSaid(t('Open your chats first, so their replies can be read.')); return; }
    const phones = stopRepliesFor(campaign, msgs);
    if (!phones.length) { setSaid(t('Nobody on this list has replied STOP.')); return; }
    await onAddSuppressed(phones);
    setSaid(phones.length === 1 ? t('1 person who replied STOP is now on the do-not-contact list.')
      : fill(t('{n} people who replied STOP are now on the do-not-contact list.'), { n: num(phones.length) }));
  }

  return (
    <section className="wa-bk-step" aria-labelledby={`${ids}-h`}>
      <h3 className="wa-bk-h" id={`${ids}-h`}>{t('Report')}</h3>
      <p className="wa-bk-quiet">
        <bdi dir="auto">{campaign.name}</bdi> · {dateText(campaign.started ?? campaign.created, { lang })} · {stateText(campaign.state, t)}
      </p>
      <ul className="wa-bk-counts">
        <li className="is-sent"><b>{num(counts.sent)}</b><span>{t('Sent')}</span></li>
        <li className="is-failed"><b>{num(counts.failed)}</b><span>{t('Failed')}</span></li>
        <li><b>{num(counts.skipped)}</b><span>{t('Skipped')}</span></li>
        <li className="is-unknown"><b>{num(counts.unknown)}</b><span>{t('Unsure')}</span></li>
      </ul>
      {counts.unknown > 0 && (
        <div className="wa-bk-card">
          <p className="wa-bk-line"><b>{t('Messages that may or may not have been sent')}</b></p>
          <p className="wa-bk-quiet">{t('The app lost touch with WhatsApp at the moment these were sent, so it cannot tell whether they arrived. They are never sent again by themselves. Look at those chats on your phone and send by hand any that did not arrive.')}</p>
        </div>
      )}
      <div className="wa-bk-acts">
        <button type="button" className="wa-bk-btn" onClick={() => void csv()}><Icon name="file" size={13} />{t('Download CSV')}</button>
        <button type="button" className="wa-bk-btn" onClick={() => void stops()}><Icon name="shield" size={13} />{t('Add STOP replies to the do-not-contact list')}</button>
        <button type="button" className="wa-bk-btn is-quiet" onClick={onDoNotContact}>{t('Do-not-contact list')}</button>
        <button type="button" className="wa-bk-btn is-quiet" onClick={onDuplicate}>{t('Use again as a new broadcast')}</button>
      </div>
      {said && <p className="wa-bk-quiet" role="status">{said}</p>}
      <div className="wa-bk-seg" role="group" aria-label={t('Show')}>
        {REPORT_FILTERS.map((f) => (
          <button key={f} type="button" className={f === filter ? 'on' : ''} aria-pressed={f === filter} onClick={() => setFilter(f)}>
            {filterName(f, t)}
          </button>
        ))}
      </div>
      {rows.length === 0 ? <p className="wa-bk-empty">{t('Nobody here.')}</p> : (
        <div className="wa-bk-table is-report" role="table" aria-label={t('Report')}>
          <div className="wa-bk-tr wa-bk-th" role="row">
            <span role="columnheader">{t('Phone')}</span>
            <span role="columnheader">{t('Name')}</span>
            <span role="columnheader">{t('Result')}</span>
          </div>
          {rows.slice(0, 400).map(({ r, o }) => (
            <div className="wa-bk-tr" role="row" key={r.phone}>
              {/* The report is the person's own record of who got what: numbers whole, here only. */}
              <span role="cell"><bdi dir="ltr" className="wa-bk-phone">+{r.phone}</bdi></span>
              <span role="cell" dir="auto">{r.name || '—'}</span>
              <span role="cell" className={standingClass(o?.standing ?? 'queued')} title={o?.why ?? ''}>
                {standingText(o?.standing ?? 'queued', t)}
              </span>
            </div>
          ))}
          {rows.length > 400 && <p className="wa-bk-quiet">{fill(t('The first {n} are shown. The CSV has everyone.'), { n: 400 })}</p>}
        </div>
      )}
    </section>
  );
}

// ── history ──────────────────────────────────────────────────────────────

export interface HistoryProps {
  t: (s: string) => string;
  lang: Lang;
  campaigns: readonly Campaign[] | null;
  onOpen: (c: Campaign) => void;
  onDuplicate: (c: Campaign) => void;
  onDelete: (c: Campaign) => void;
  onDoNotContact: () => void;
}

export function HistoryView({ t, lang, campaigns, onOpen, onDuplicate, onDelete, onDoNotContact }: HistoryProps) {
  const [deleting, setDeleting] = useState('');
  const ids = useId();
  const list = campaigns ? [...campaigns].sort((a, b) => Number(!!b.staged) - Number(!!a.staged) || b.updated - a.updated) : null;
  return (
    <section className="wa-bk-step" aria-labelledby={`${ids}-h`}>
      <h3 className="wa-bk-h" id={`${ids}-h`}>{t('Past broadcasts')}</h3>
      {list === null ? <p className="wa-bk-empty">{t('Loading…')}</p>
        : list.length === 0 ? <p className="wa-bk-empty">{t('No broadcasts yet.')}</p> : (
          <ul className="wa-bk-rows">
            {list.map((c) => {
              const n = countsOf(c);
              return (
                <li key={c.id} className="wa-bk-hist">
                  <span className="wa-bk-rowwhat">
                    <b dir="auto">{c.name}</b>
                    <small>
                      {c.staged ? t('Prepared by the assistant. Nothing has been sent.') : (
                        <>{dateText(c.started ?? c.created, { lang })} · {stateText(c.state, t)} · {fill(t('{sent} of {total} sent'), { sent: num(n.sent), total: num(n.total) })}</>
                      )}
                    </small>
                  </span>
                  <span className="wa-bk-acts">
                    <button type="button" className="wa-bk-btn is-small" onClick={() => onOpen(c)}>
                      {c.staged || c.state === 'draft' ? t('Review') : t('Open the report')}
                    </button>
                    {!c.staged && <button type="button" className="wa-bk-btn is-small is-quiet" onClick={() => onDuplicate(c)}>{t('Use again')}</button>}
                    {c.state !== 'running' && (
                      <button type="button" className={deleting === c.id ? 'wa-bk-btn is-small is-danger' : 'wa-bk-btn is-small is-quiet'}
                              onClick={() => { if (deleting !== c.id) { setDeleting(c.id); return; } setDeleting(''); onDelete(c); }}
                              onBlur={() => setDeleting('')}>
                        {deleting === c.id ? t('Press again to delete') : t('Delete')}
                      </button>
                    )}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      <button type="button" className="wa-bk-btn is-quiet" onClick={onDoNotContact}>
        <Icon name="shield" size={13} />{t('Do-not-contact list')}
      </button>
    </section>
  );
}

// ── the do-not-contact list ──────────────────────────────────────────────

export interface DoNotContactProps {
  t: (s: string) => string;
  list: readonly string[] | null;
  country: string;
  onAdd: (phone: string) => Promise<void>;
  onRemove: (phone: string) => Promise<void>;
}

export function DoNotContactView({ t, list, country, onAdd, onRemove }: DoNotContactProps) {
  const [typed, setTyped] = useState('');
  const [bad, setBad] = useState('');
  const ids = useId();
  async function add() {
    const n = normalisePhone(typed, country);
    if (!('phone' in n)) { setBad(t('That phone number could not be read.')); return; }
    setBad('');
    setTyped('');
    await onAdd(n.phone);
  }
  return (
    <section className="wa-bk-step" aria-labelledby={`${ids}-h`}>
      <h3 className="wa-bk-h" id={`${ids}-h`}>{t('Do-not-contact list')}</h3>
      <p className="wa-bk-quiet">{t('Nobody on this list gets a broadcast from this computer, whatever list they are on. People who reply STOP are added here.')}</p>
      <div className="wa-bk-save">
        <input className="wa-bk-input" dir="ltr" inputMode="tel" value={typed} placeholder="+964 …" aria-label={t('Add a number')}
               onChange={(e) => setTyped(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void add(); } }} />
        <button type="button" className="wa-bk-btn" disabled={!typed.trim()} onClick={() => void add()}>
          <Icon name="plus" size={13} />{t('Add a number')}
        </button>
      </div>
      {bad && <p className="wa-why" role="alert">{bad}</p>}
      {list === null ? <p className="wa-bk-empty">{t('Loading…')}</p>
        : list.length === 0 ? <p className="wa-bk-empty">{t('Nobody is on the list.')}</p> : (
          <>
            <p className="wa-bk-line">{fill(list.length === 1 ? t('{n} person') : t('{n} people'), { n: num(list.length) })}</p>
            <ul className="wa-bk-rows">
              {list.slice(0, 500).map((p) => (
                <li key={p} className="wa-bk-rowline">
                  <Masked phone={p} />
                  <button type="button" className="wa-bk-icon" onClick={() => void onRemove(p)}
                          title={t('Take off the list')} aria-label={fill(t('Take {phone} off the list'), { phone: maskPhone(p) })}>
                    <Icon name="close" size={12} />
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
    </section>
  );
}
