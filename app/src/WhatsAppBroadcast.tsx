import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from './Icon';
import { fill, type Lang } from './i18n';
import type { EffortBook } from './effort';
import type { Target } from './generate';
import { ready as connReady, type Account, type Chat, type Msg } from './whatsapp';
import { countryForLang } from './whatsappaudience';
import { clampPace, newCampaign } from './whatsappcampaign';
import { recover } from './whatsappsend';
import {
  addSuppressed, deleteAudience, deleteCampaign, loadAudiences, loadCampaigns, loadSuppressed, removeSuppressed, saveAudience, saveCampaign, sentToday,
} from './whatsappbulkstore';
import {
  DEFAULT_PACE, LIMITS, MESSAGE_LANGS, PACE_BOUNDS, type Attachment, type Campaign, type Pace, type Recipient,
} from './whatsappbulktypes';
import {
  AudienceStep, Fill, WORK_AUDIENCE_ID, columnsOf, forgetInput, num, peopleFromAudience, type People,
} from './WhatsAppPeople';
import { ComposeStep, PreviewPane, draftOf, messageNotes, type MessageWork } from './WhatsAppCompose';
import {
  DoNotContactView, HistoryView, ReportView, ReviewStep, RunView, countsOf, dismissRun, interruptedOf, launch, liveRun,
  refusalText, useLive,
} from './WhatsAppRun';

/**
 * Broadcast: one message to many people, sent slowly, by a person who pressed
 * Send on a screen that showed exactly what would go (docs/WA.md).
 *
 * Three steps, always the same — **1 People**, **2 Message**, **3 Review &
 * send** — then the live run and its report. Each step has one obvious next
 * button and, when it cannot go on, one sentence saying why. In the 248 px
 * column the steps come one at a time with Back and Next in a bar that stays
 * at the bottom; in a window they sit on the left, the step in the middle,
 * and who it goes to and how it will look on the right.
 *
 * ## What is kept when the panel closes
 *
 * The draft — the words, the ready message it came from, the language, the
 * opt-out line, the country, the pace, the step — in `localStorage` under
 * `DRAFT_KEY`, read back through `readWork`, which clamps every field: a value
 * from an older build or a hand-edited store is input, not memory. The people
 * go to IndexedDB as the working list (`WORK_AUDIENCE_ID`), because five
 * thousand people do not belong in `localStorage`. An attachment is kept for
 * the life of the window only: sixteen megabytes do not belong in either.
 * Consent is never kept: it is ticked for each broadcast, on the card that
 * shows that broadcast. *Start over* clears the words and the people and keeps
 * the preferences (country, pace, language, opt-out).
 *
 * ## What it never does
 *
 * Start a campaign anywhere but `launch` (WhatsAppRun.tsx), show a key or the
 * gateway's address, or show a whole number outside the report.
 */
export interface BroadcastProps {
  t: (s: string) => string;
  lang: Lang;
  /** The account shown in the panel, or null before one is set up. */
  account: Account | null;
  /** The panel is a window rather than a column. */
  full: boolean;
  /** The model route, when one is set up: the writer needs it. */
  gw?: Target;
  efforts?: EffortBook;
  onProviders: () => void;
  onClose: () => void;
  /** The account's chats, for *From my chats* (whatsapp.ts `chatsFrom`). */
  chats?: readonly Chat[];
  /** The loaded messages, so the report can find STOP replies (`optOutPhones`). */
  msgs?: readonly Msg[];
  /** A campaign to open on the review card, by id: the assistant's staged draft. */
  openCampaign?: string;
}

// ── the remembered draft ─────────────────────────────────────────────────

export type Step = 1 | 2 | 3;

/** Everything a broadcast-in-progress remembers, but the people and the attachment. */
export interface Work extends MessageWork {
  step: Step;
  /** The calling code for numbers written without one, digits only. */
  country: string;
  pace: Pace;
  /** The id the campaign will be saved under: an assistant's draft keeps its own. */
  id: string;
  /** It came from the assistant (`Campaign.staged`), and nothing has been sent. */
  staged: boolean;
}

export const DRAFT_KEY = 'vylo.whatsapp.bulk.draft.v1';

const freshId = (): string => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

/** A new draft in the interface's language, with the product's defaults. */
export function blankWork(lang: Lang, keep?: Pick<Work, 'country' | 'pace' | 'lang' | 'optOut' | 'business'>): Work {
  return {
    text: '', lang: keep?.lang ?? lang, optOut: keep?.optOut ?? true, optOutText: '', templateId: '', business: keep?.business ?? '',
    step: 1, country: keep?.country ?? countryForLang(lang), pace: keep?.pace ?? { ...DEFAULT_PACE }, id: freshId(), staged: false,
  };
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const within = (v: unknown, [lo, hi]: readonly [number, number], dflt: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : dflt;

/** A pace read from storage, every field inside `PACE_BOUNDS` and the longest wait never under the shortest. */
export function readPace(v: unknown): Pace {
  const o = v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
  const minDelaySec = within(o.minDelaySec, PACE_BOUNDS.minDelaySec, DEFAULT_PACE.minDelaySec);
  return clampPace({
    minDelaySec,
    maxDelaySec: Math.max(minDelaySec, within(o.maxDelaySec, PACE_BOUNDS.maxDelaySec, DEFAULT_PACE.maxDelaySec)),
    batchSize: within(o.batchSize, PACE_BOUNDS.batchSize, DEFAULT_PACE.batchSize),
    batchPauseSec: within(o.batchPauseSec, PACE_BOUNDS.batchPauseSec, DEFAULT_PACE.batchPauseSec),
    dailyCap: within(o.dailyCap, PACE_BOUNDS.dailyCap, DEFAULT_PACE.dailyCap),
    stopAfterFailures: within(o.stopAfterFailures, PACE_BOUNDS.stopAfterFailures, DEFAULT_PACE.stopAfterFailures),
    typing: typeof o.typing === 'boolean' ? o.typing : DEFAULT_PACE.typing,
  });
}

/**
 * The remembered draft, from whatever `localStorage` holds.
 *
 * Every field is checked on its own and falls back on its own, so one bad
 * value costs that value and not the whole draft: a typo in the pace does not
 * throw away a message somebody spent ten minutes on.
 */
export function readWork(raw: string | null, lang: Lang): Work {
  const base = blankWork(lang);
  let o: Record<string, unknown> = {};
  try {
    const v: unknown = raw ? JSON.parse(raw) : null;
    if (v && typeof v === 'object' && !Array.isArray(v)) o = v as Record<string, unknown>;
  } catch { /* not JSON: a fresh draft */ }
  const msgLang = MESSAGE_LANGS.find((l) => l === o.lang) ?? base.lang;
  const step = o.step === 2 || o.step === 3 ? o.step : 1;
  const country = typeof o.country === 'string' && /^\d{1,4}$/.test(o.country) ? o.country : base.country;
  const id = typeof o.id === 'string' && /^[\w-]{1,48}$/.test(o.id) ? o.id : base.id;
  return {
    text: str(o.text, LIMITS.messageChars), lang: msgLang, optOut: typeof o.optOut === 'boolean' ? o.optOut : true,
    optOutText: str(o.optOutText, 200), templateId: str(o.templateId, 60), business: str(o.business, LIMITS.valueChars),
    step, country, pace: readPace(o.pace), id, staged: o.staged === true,
  };
}

/** The draft as stored: no attachment (megabytes), nothing that is not the person's own choice. */
export function writeWork(w: Work): string {
  const { attachment: _drop, ...rest } = w;
  void _drop;
  return JSON.stringify(rest);
}

/**
 * Why a step cannot go on, in one sentence; '' when it can.
 *
 * Step 3's own problems are the engine's (`validateCampaign`) and are listed
 * on the card itself; this is about getting there.
 */
export function blockerOf(step: Step, people: People | null, msg: MessageWork, t: (s: string) => string): string {
  if (step >= 1) {
    if (!people) return t('Add at least one person.');
    if (people.recipients.length === 0) {
      return people.removed > 0 ? t('Everyone on this list asked not to be messaged.') : t('Add at least one person.');
    }
  }
  if (step >= 2) {
    if (!msg.text.trim() && !msg.attachment) return t('Write a message, or attach something.');
    const notes = messageNotes(msg, people, t);
    if (notes.block.length) return notes.block[0];
  }
  return '';
}

/** A name for the campaign, for the history: the list's name, else the start of the message. */
export function campaignName(people: People | null, text: string, fallback: string): string {
  if (people?.audienceName) return people.audienceName.slice(0, 80);
  const line = text.split('\n').map((s) => s.trim()).find(Boolean) ?? '';
  return line ? (line.length > 48 ? `${line.slice(0, 47)}…` : line) : fallback;
}

/**
 * What a consent tick and a typed count are given for: this broadcast, from this account, to exactly these people.
 *
 * The tick says "everyone on *this list* agreed". Held as a plain boolean it outlived the list it was given for: tick
 * it for ten people, go back, read another list, and the box came back ticked. So the tick is kept as the key it was
 * given under and counts only while the key still matches, and the review card is drawn per key, so a count typed for
 * one list is never standing in the box for another. A hash of every number, in order, not a sample: one number
 * changed is a different list.
 */
export function reviewKey(id: string, recipients: readonly Recipient[], accountId: string): string {
  let h = 0x811c9dc5;
  for (const r of recipients) {
    const p = String(r.phone);
    for (let i = 0; i < p.length; i++) { h ^= p.charCodeAt(i); h = Math.imul(h, 16777619); }
    h ^= 0x2c; h = Math.imul(h, 16777619);
  }
  return `${id}|${accountId}|${recipients.length}|${(h >>> 0).toString(36)}`;
}

/** The attachment, held for the life of the window (see the header). */
let heldAttachment: Attachment | undefined;

// ── the screens ──────────────────────────────────────────────────────────

type View = 'steps' | 'run' | 'report' | 'history' | 'dnc';

export function WhatsAppBroadcast({ t, lang, account, full, gw, efforts, onProviders, onClose, chats, msgs, openCampaign }: BroadcastProps) {
  const [work, setWork] = useState<Work>(() => {
    let raw: string | null = null;
    try { raw = localStorage.getItem(DRAFT_KEY); } catch { raw = null; }
    return { ...readWork(raw, lang), attachment: heldAttachment };
  });
  useEffect(() => {
    heldAttachment = work.attachment;
    try { localStorage.setItem(DRAFT_KEY, writeWork(work)); } catch { /* private mode */ }
  }, [work]);
  const patch = useCallback((p: Partial<Work>) => setWork((w) => ({ ...w, ...p })), []);

  const [people, setPeopleState] = useState<People | null>(null);
  /** Set when the person changes the people, so the working list is written; a restore does not write. */
  const peopleDirty = useRef(false);
  const setPeople = useCallback((p: People | null) => { peopleDirty.current = true; setPeopleState(p); }, []);
  const [suppressed, setSuppressed] = useState<ReadonlySet<string>>(new Set());
  /** The review key the box was ticked under; '' when it is not ticked (see `reviewKey`). */
  const [consentFor, setConsentFor] = useState('');
  const [view, setView] = useState<View>('steps');
  const [back, setBack] = useState<View>('steps');
  const [campaigns, setCampaigns] = useState<Campaign[] | null>(null);
  const [reportOf, setReportOf] = useState<Campaign | null>(null);
  /** A stored campaign this window does not hold: interrupted by a quit, halted, or paused and closed. */
  const [held, setHeld] = useState<{ c: Campaign; interrupted: boolean } | null>(null);
  const [dnc, setDnc] = useState<string[] | null>(null);
  const [today, setToday] = useState(0);
  const [runWhy, setRunWhy] = useState('');
  const [clearing, setClearing] = useState(false);
  const run = useLive();
  const stepBox = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  const root = useRef<HTMLDivElement>(null);
  const firstView = useRef(true);

  // ── loading what is kept ───────────────────────────────────────────────
  useEffect(() => {
    let live = true;
    void (async () => {
      const sup = await loadSuppressed().catch(() => new Set<string>());
      if (!live) return;
      setSuppressed(sup);
      const lists = await loadAudiences().catch(() => []);
      const work0 = lists.find((a) => a.id === WORK_AUDIENCE_ID);
      if (live && work0 && work0.recipients.length > 0) setPeopleState((p) => p ?? peopleFromAudience(work0, sup));
      const all = await loadCampaigns().catch(() => [] as Campaign[]);
      if (!live) return;
      setCampaigns(all);
      // A run this window holds is shown first: still sending, or ended by itself with a reason the person has not seen.
      const holding = liveRun();
      if (holding) { setView('run'); return; }
      // A campaign stored as running that this window does not hold was interrupted: recover it before anything else.
      const stuck = all.find((c) => interruptedOf(c, null));
      if (stuck) {
        const safe = recover(stuck);
        await saveCampaign(safe).catch(() => false);
        if (!live) return;
        setHeld({ c: safe, interrupted: true });
        setView('run');
        return;
      }
      const resumable = all.find((c) => (c.state === 'paused' || c.state === 'halted') && countsOf(c).queued > 0);
      if (resumable) setHeld({ c: resumable, interrupted: false });
      const asked = openCampaign ? all.find((c) => c.id === openCampaign) : undefined;
      if (asked && (asked.staged || asked.state === 'draft')) openOnReview(asked);
    })();
    return () => { live = false; };
    // Loaded once per opening of the screen; the store is the source after that.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The working list is written a moment after the person stops changing it.
  useEffect(() => {
    if (!peopleDirty.current) return;
    const id = setTimeout(() => {
      // No people (Start over, a list cleared): the working list goes, rather than coming back as "0 people".
      if (!people || people.recipients.length === 0) { void deleteAudience(WORK_AUDIENCE_ID).catch(() => undefined); return; }
      const now = Date.now();
      void saveAudience({
        id: WORK_AUDIENCE_ID, name: WORK_AUDIENCE_ID, recipients: people.recipients.slice(0, LIMITS.recipients),
        source: people.source, file: people.file, created: now, updated: now,
      }).catch(() => false);
    }, 400);
    return () => clearTimeout(id);
  }, [people]);

  // What this account has sent today, for the cap; asked again on the review card.
  useEffect(() => {
    if (!account || (work.step !== 3 && view !== 'run')) return;
    let live = true;
    void sentToday(account.id).then((n) => { if (live) setToday(n); }).catch(() => undefined);
    return () => { live = false; };
  }, [account, work.step, view]);

  // A new step takes the focus, so a screen reader says where the person is.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    stepBox.current?.focus();
  }, [work.step]);

  // A new view takes the focus too. The button that led to it (History, See the report, Back, Send) is gone with the
  // view it was on, and focus left on <body> is a keyboard user who is nowhere — and the drawers' Escape, which listens
  // on the drawer, no longer reaches it either.
  useEffect(() => {
    if (firstView.current) { firstView.current = false; return; }
    root.current?.querySelector<HTMLElement>('.wa-bk-stepbox, .wa-bk-run')?.focus();
  }, [view]);

  // ── moving between screens ─────────────────────────────────────────────
  const msg: MessageWork = work;
  const blocked = (s: Step) => blockerOf(s, people, msg, t);
  const go = (s: Step) => { setView('steps'); patch({ step: s }); };

  function openOnReview(c: Campaign) {
    heldAttachment = c.message.attachment;
    setWork({
      ...blankWork(lang, { country: work.country, pace: c.pace, lang: c.message.lang, optOut: c.message.optOut, business: work.business }),
      text: c.message.text, optOutText: c.message.optOutText ?? '', attachment: c.message.attachment, id: c.id, staged: !!c.staged, step: 3,
    });
    setPeopleState({ ...peopleFromAudience({ id: '', name: '', recipients: c.recipients, source: 'text', created: 0, updated: 0 }, suppressed), audienceId: c.audienceId });
    peopleDirty.current = true;
    setConsentFor('');
    setView('steps');
  }

  function reuse(c: Campaign) {
    openOnReview({ ...c, id: freshId(), staged: false });
    patch({ step: 1, staged: false });
  }

  function startOver() {
    forgetInput();
    heldAttachment = undefined;
    setWork(blankWork(lang, { country: work.country, pace: work.pace, lang: work.lang, optOut: work.optOut, business: work.business }));
    setPeople(null);
    setConsentFor('');
    setView('steps');
  }

  // ── the campaign on the review card ────────────────────────────────────
  const reviewAt = useMemo(() => reviewKey(work.id, people?.recipients ?? [], account?.id ?? ''), [work.id, people, account]);
  const consent = consentFor !== '' && consentFor === reviewAt;
  const setConsent = (yes: boolean) => setConsentFor(yes ? reviewAt : '');
  const campaign = useMemo<Campaign>(() => ({
    ...newCampaign({
      id: work.id, name: campaignName(people, work.text, t('Broadcast')), accountId: account?.id ?? '',
      recipients: people?.recipients ?? [], message: draftOf(work), pace: work.pace, audienceId: people?.audienceId,
      staged: work.staged || undefined,
    }),
    consent,
  }), [work, people, account, consent, t]);

  async function send(): Promise<string> {
    const why = await launch(campaign, account, today);
    if (why) return refusalText(why, t);
    // The draft became a campaign: a later edit must not overwrite it, and consent is for that one broadcast.
    patch({ id: freshId(), staged: false });
    setConsentFor('');
    setHeld(null);
    setView('run');
    return '';
  }

  async function cont(c: Campaign) {
    setRunWhy('');
    // The campaign as stored: it was started with Send, so its consent is the person's own tick, never set here.
    const why = await launch(c, account, today);
    if (why) { setRunWhy(refusalText(why, t)); return; }
    setHeld(null);
  }

  function openReport(c: Campaign) {
    setReportOf(c);
    setBack(view === 'report' ? back : view);
    setView('report');
  }

  async function openHistory() {
    setBack(view === 'history' ? back : view);
    setView('history');
    setCampaigns(await loadCampaigns().catch(() => []));
  }

  async function openDnc() {
    setBack(view === 'dnc' ? back : view);
    setView('dnc');
    const s = await loadSuppressed().catch(() => new Set<string>());
    setSuppressed(s);
    setDnc([...s].sort());
  }

  async function addDnc(phones: string[]) {
    await addSuppressed(phones).catch(() => undefined);
    const s = await loadSuppressed().catch(() => new Set<string>());
    setSuppressed(s);
    setDnc([...s].sort());
  }

  async function removeDnc(phone: string) {
    await removeSuppressed(phone).catch(() => undefined);
    const s = await loadSuppressed().catch(() => new Set<string>());
    setSuppressed(s);
    setDnc([...s].sort());
  }

  // ── drawing ────────────────────────────────────────────────────────────
  const going = !!run && !run.over;
  const runShown = view === 'run' && (run || held);
  const stepName = (s: Step): string => (s === 1 ? t('People') : s === 2 ? t('Message') : t('Review & send'));
  const furthest: Step = blocked(1) ? 1 : blocked(2) ? 2 : 3;
  const why = work.step < 3 ? blocked(work.step) : '';
  const staged = (campaigns ?? []).filter((c) => c.staged && c.state === 'draft' && c.id !== work.id);
  const sub = view === 'history' || view === 'report' || view === 'dnc';

  const head = (
    <div className="wa-bk-head">
      {sub ? (
        <button type="button" className="wa-bk-icon" onClick={() => setView(back === view ? 'steps' : back)}
                title={t('Back')} aria-label={t('Back')}>
          <Icon name="chevron" size={14} turn={180} className="ic-dir" />
        </button>
      ) : (
        <button type="button" className="wa-bk-icon" onClick={onClose} title={t('Back to chats')} aria-label={t('Back to chats')}>
          <Icon name="close" size={13} />
        </button>
      )}
      <span className="wa-bk-title">
        <b>{t('Broadcast')}</b>
        {account
          ? <small><i className={connReady(account) ? 'wa-bk-dot' : 'wa-bk-dot is-off'} aria-hidden="true" /><bdi>{account.name}</bdi></small>
          : <small>{t('No WhatsApp account is connected.')}</small>}
      </span>
      {going && view !== 'run' && (
        <button type="button" className="wa-bk-pill" onClick={() => setView('run')}>
          <Icon name="send" size={11} />{t('Sending')}
        </button>
      )}
      {view !== 'history' && (
        <button type="button" className="wa-bk-icon" onClick={() => void openHistory()} title={t('History')} aria-label={t('History')}>
          <Icon name="clock" size={14} />
        </button>
      )}
    </div>
  );

  const stepper = (
    <ol className="wa-bk-steps" aria-label={t('Steps')}>
      {([1, 2, 3] as const).map((s) => (
        <li key={s}>
          <button type="button" className={s === work.step ? 'wa-bk-stepb on' : s < furthest || s < work.step ? 'wa-bk-stepb done' : 'wa-bk-stepb'}
                  aria-current={s === work.step && view === 'steps' ? 'step' : undefined}
                  disabled={going || s > furthest} onClick={() => go(s)}>
            <i aria-hidden="true">{s < work.step && !blocked(s) ? <Icon name="check" size={11} /> : s}</i>
            <span>{stepName(s)}</span>
          </button>
        </li>
      ))}
    </ol>
  );

  const banners = (
    <>
      {staged.map((c) => (
        <div key={c.id} className="wa-bk-banner">
          <Icon name="sparkle" size={13} />
          <span>
            <b dir="auto">{c.name}</b>
            <small>{t('Prepared by the assistant. Nothing has been sent.')} {fill(t('{n} people'), { n: num(c.recipients.length) })}</small>
          </span>
          <button type="button" className="wa-bk-btn is-small" onClick={() => openOnReview(c)}>{t('Review')}</button>
        </div>
      ))}
      {held && !going && view === 'steps' && (
        <div className="wa-bk-banner is-warn">
          <Icon name="pause" size={13} />
          <span>
            <b dir="auto">{held.c.name}</b>
            <small>{held.c.state === 'halted' ? t('Stopped by itself') : t('Paused')}</small>
          </span>
          <button type="button" className="wa-bk-btn is-small" onClick={() => setView('run')}>{t('Open')}</button>
        </div>
      )}
    </>
  );

  const stepBody = (
    <div className="wa-bk-stepbox" ref={stepBox} tabIndex={-1} aria-label={stepName(work.step)}>
      {work.step === 1 && (
        <AudienceStep t={t} lang={lang} people={people} onPeople={setPeople} country={work.country}
                      onCountry={(country) => patch({ country })} chats={chats} suppressed={suppressed} />
      )}
      {work.step === 2 && (
        <ComposeStep t={t} lang={lang} msg={msg} onMsg={patch} people={people} country={work.country} full={full}
                     gw={gw} efforts={efforts} onProviders={onProviders} />
      )}
      {work.step === 3 && (
        <ReviewStep key={reviewAt} t={t} account={account} campaign={campaign} msg={msg} sentToday={today} country={work.country}
                    onPace={(pace) => patch({ pace })} onConsent={setConsent} onSend={send} />
      )}
    </div>
  );

  const foot = (
    <div className="wa-bk-bar">
      {why && <p className="wa-bk-why">{why}</p>}
      <div className="wa-bk-bar-row">
        {work.step > 1 ? (
          <button type="button" className="wa-bk-btn" onClick={() => go((work.step - 1) as Step)}>
            <Icon name="chevron" size={12} turn={180} className="ic-dir" />{t('Back')}
          </button>
        ) : (
          <button type="button" className={clearing ? 'wa-bk-btn is-quiet is-danger' : 'wa-bk-btn is-quiet'}
                  disabled={!people && !work.text}
                  onClick={() => { if (!clearing) { setClearing(true); return; } setClearing(false); startOver(); }}
                  onBlur={() => setClearing(false)}>
            {clearing ? t('Press again to start over') : t('Start over')}
          </button>
        )}
        {work.step < 3 && (
          <button type="button" className="sb-cta-go wa-bk-go" disabled={!!why} onClick={() => go((work.step + 1) as Step)}>
            {work.step === 1 ? t('Next: the message') : t('Next: check and send')}
            <Icon name="chevron" size={12} className="ic-dir" />
          </button>
        )}
      </div>
    </div>
  );

  let main;
  if (view === 'history') {
    main = (
      <div className="wa-bk-stepbox" tabIndex={-1} aria-label={t('Past broadcasts')}><HistoryView t={t} lang={lang} campaigns={campaigns}
                   onOpen={(c) => (c.staged || c.state === 'draft' ? openOnReview(c) : openReport(c))}
                   onDuplicate={reuse}
                   onDelete={(c) => { void deleteCampaign(c.id).then(() => loadCampaigns()).then(setCampaigns).catch(() => undefined); }}
                   onDoNotContact={() => void openDnc()} /></div>
    );
  } else if (view === 'report' && reportOf) {
    main = (
      <div className="wa-bk-stepbox" tabIndex={-1} aria-label={t('Report')}><ReportView t={t} lang={lang} campaign={run && run.campaign.id === reportOf.id ? run.campaign : reportOf} msgs={msgs}
                  onAddSuppressed={addDnc} onDuplicate={() => reuse(reportOf)} onDoNotContact={() => void openDnc()} /></div>
    );
  } else if (view === 'dnc') {
    main = (
      <div className="wa-bk-stepbox" tabIndex={-1} aria-label={t('Do-not-contact list')}>
        <DoNotContactView t={t} list={dnc} country={work.country} onAdd={(p) => addDnc([p])} onRemove={removeDnc} />
      </div>
    );
  } else if (runShown) {
    const shownCampaign = run ? run.campaign : (held as { c: Campaign }).c;
    main = (
      <>
        <RunView t={t} campaign={shownCampaign} run={run} interrupted={!run && !!held?.interrupted}
                 onContinue={() => void cont(shownCampaign)} onReport={() => openReport(shownCampaign)}
                 onDone={() => { dismissRun(); setHeld(null); startOver(); }} />
        {runWhy && <p className="wa-why" role="alert">{runWhy}</p>}
      </>
    );
  } else {
    main = full ? (
      <>{banners}{stepBody}{foot}</>
    ) : (
      <>{stepper}{banners}{stepBody}{foot}</>
    );
  }

  if (!full) {
    return (
      <div ref={root} className="wa wa-bk">
        {head}
        {main}
      </div>
    );
  }

  const inSteps = !sub && !runShown;
  return (
    <div ref={root} className="wa wa-bk is-full">
      {head}
      <div className="wa-bk-body">
        <nav className="wa-bk-nav" aria-label={t('Steps')}>
          {inSteps ? stepper : (
            <button type="button" className="wa-bk-btn is-quiet" onClick={() => setView(going || held ? 'run' : 'steps')}>
              <Icon name="chevron" size={12} turn={180} className="ic-dir" />{going || held ? t('Sending') : t('Broadcast')}
            </button>
          )}
        </nav>
        <main className="wa-bk-main">{main}</main>
        {inSteps && (
          <aside className="wa-bk-aside" aria-label={t('Summary')}>
            <section className="wa-bk-sumcard">
              <h4 className="wa-bk-sub">{t('People')}</h4>
              {people && people.recipients.length ? (
                <>
                  <p className="wa-bk-sum-big">
                    <Fill text={people.recipients.length === 1 ? t('{n} person') : t('{n} people')} parts={{ n: <b>{num(people.recipients.length)}</b> }} />
                  </p>
                  {columnsOf(people.recipients).length > 0 && (
                    <p className="wa-bk-quiet">{fill(t('Details from the list: {list}'), { list: columnsOf(people.recipients).join(' · ') })}</p>
                  )}
                </>
              ) : <p className="wa-bk-quiet">{t('Nobody yet.')}</p>}
            </section>
            <PreviewPane t={t} msg={msg} people={people} />
          </aside>
        )}
      </div>
    </div>
  );
}
