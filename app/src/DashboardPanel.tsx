import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { fill } from './i18n';
import { ago, missedRuns, until } from './when';
import type { Agent } from './agents';
import { nextRun, phrase, type Routine } from './routines';

/**
 * The Agent mode home: what ran, what is due, and what to do about it.
 *
 * Everything on this screen is derived from the routine list and the agents
 * file — nothing is stored for the dashboard's own sake, so nothing on it can
 * be stale relative to the lists it summarises. It answers the questions
 * somebody opens the app with after being away: did anything run, did
 * anything fail, what is next, and where do I read the results.
 *
 * Two of those answers are only worth having if they are whole. "Failed" is
 * counted over every routine rather than over the six rows below it, or a tile
 * reading zero would be a claim the list beneath it contradicts. And the
 * missed-run notice names the routines and the slots they wanted: SAFETY says
 * missed work is reported and skipped, and a bare count reports nothing a
 * person can act on. Dismissing it clears the list in App — see `onDismiss`.
 *
 * The wording for every relative time comes from `when.ts`. It used to be
 * written here and again in the routines panel, and the two had already
 * drifted: this file could say "3 days ago" about the past and "In 144 hours"
 * about the future, four lines apart.
 */

interface Props {
  t: (s: string) => string;
  routines: Routine[];
  agents: Agent[];
  /** Runs missed while the app was closed, reported once at launch. */
  missed: Routine[];
  onRun: (r: Routine) => void;
  onOpen: (chatId: string) => void;
  onRoutines: () => void;
  onNewChat: () => void;
  /**
   * Acknowledge the missed-run notice and clear it.
   *
   * Optional: without it the notice simply has no dismiss, which is what it
   * had before — a banner that stays for the whole session. It is a prop
   * rather than local state because the list lives in App, and a notice that
   * hid itself while the list it reports stayed set would be a lie the next
   * time this panel mounted.
   */
  onDismiss?: () => void;
}

export function DashboardPanel({
  t, routines, agents, missed, onRun, onOpen, onRoutines, onNewChat, onDismiss,
}: Props) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const upcoming = routines
    .map((r) => ({ r, at: nextRun(r, now) }))
    .filter((x): x is { r: Routine; at: number } => x.at !== null && !x.r.paused)
    .sort((a, b) => a.at - b.at)
    .slice(0, 5);
  const recent = routines
    .filter((r) => r.lastRun)
    .sort((a, b) => (b.lastRun!.at) - (a.lastRun!.at))
    .slice(0, 6);
  // Counted over every routine, not over `recent`. The tile is the answer to
  // "did anything fail", and taking it from a list truncated to six meant a
  // seventh routine could fail while the tile said none had — and said it in
  // black rather than red.
  const failed = routines.filter((r) => r.lastRun && !r.lastRun.ok).length;
  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id;
  /**
   * What Run now will do, for this row's agent.
   *
   * The button is a hand run, and App gives a hand run the agent's own mode —
   * `modeFor(agent, byHand || autoOn(auto))` — because a person is at the
   * approval dialog. The promise therefore differs per row, and "Run now" on
   * its own said nothing about which row was which. Looked up by `r.agent`,
   * the same way `agentName` above is, so both read the one list this panel
   * is given.
   *
   * An agent missing from `.vylo/AGENTS.md` gets the narrower sentence: the
   * run is refused before anything happens, and of the two wordings the one
   * that promises less is the one to be wrong in.
   */
  const runTitle = (r: Routine) => (agents.find((a) => a.id === r.agent)?.mode === 'agent'
    ? t('Run now — may edit, behind the approval dialog')
    : t('Run now — reads only'));
  /** A `when` phrase, translated and filled. Both directions, one module. */
  const say = (p: { key: string; vars: Record<string, string | number> }) => fill(t(p.key), p.vars);
  /** A schedule as a sentence, with the weekday in the reader's language. */
  const said = (r: Routine) => {
    const ph = phrase(r.schedule);
    return fill(t(ph.key), { ...ph.vars, day: typeof ph.vars.day === 'string' ? t(ph.vars.day) : '' });
  };

  return (
    <div className="db">
      <div className="db-facts">
        <div><b>{agents.length}</b><span>{agents.length === 1 ? t('agent') : t('agents')}</span></div>
        <div><b>{routines.filter((r) => !r.paused).length}</b><span>{t('on a schedule')}</span></div>
        <div className={failed ? 'bad' : ''}><b>{failed}</b><span>{t('failed')}</span></div>
      </div>

      {/* Named, not counted. "Three runs were skipped" is a fact nobody can
          act on; the routine and the slot it wanted are what a person needs to
          decide whether to run one by hand.

          The count and the list are the same array, so they cannot disagree
          about how many there were — which is what makes the notice survive
          `missed` arriving filtered to the open folder: it says "1 run was
          due" over one line, and the plural sentence over the rest, without
          this panel having to know what was filtered out. `missedRuns` owns
          the singular/plural split and renders nothing at 0; the guard here
          means it is never asked, and the empty state of this notice is no
          notice at all. */}
      {missed.length > 0 && (
        <div className="db-missed">
          <Icon name="warning" size={12} />
          <div className="db-missed-what">
            <span>{say(missedRuns(missed.length))}</span>
            <ul>{missed.map((r) => <li key={r.id}>{r.name} · {said(r)}</li>)}</ul>
          </div>
          {onDismiss && (
            <button className="todo-x" onClick={onDismiss} title={t('Close')} aria-label={t('Close')}>
              <Icon name="close" size={11} />
            </button>
          )}
        </div>
      )}

      <div className="sb-sub">{t('Up next')}</div>
      {upcoming.length === 0 ? (
        <p className="ft-empty">{t('Nothing scheduled.')}</p>
      ) : (
        <ul className="db-list">
          {upcoming.map(({ r, at }) => (
            <li key={r.id} className="db-row">
              <span className="db-what">
                <b>{r.name}</b>
                <span>{agentName(r.agent)} · {said(r)}</span>
              </span>
              {/* A run the scheduler is holding says why, in place of a "Due
                  now" that would otherwise sit there unexplained. */}
              <em>{r.held && at <= now ? r.held : say(until(at, now))}</em>
              <button className="todo-act" onClick={() => onRun(r)} title={runTitle(r)} aria-label={`${t('Run now')} — ${r.name}`}><Icon name="play" size={12} /></button>
            </li>
          ))}
        </ul>
      )}

      <div className="sb-sub">{t('Recent runs')}</div>
      {recent.length === 0 ? (
        <p className="ft-empty">{t('Nothing has run yet.')}</p>
      ) : (
        <ul className="db-list">
          {recent.map((r) => (
            <li key={r.id} className={`db-row ${r.lastRun!.ok ? 'ok' : 'bad'}`}>
              <span className={`db-dot ${r.lastRun!.ok ? 'ok' : 'bad'}`} aria-hidden="true" />
              <span className="db-what">
                <b>{r.name}</b>
                <span>{r.lastRun!.ok ? say(ago(r.lastRun!.at, now)) : (r.lastRun!.error || t('Failed'))}</span>
              </span>
              {/* Only when the run wrote one. A run refused before a chat
                  existed — no agent, no key — carries an empty id, and Open
                  for it did nothing at all. */}
              {r.lastRun!.chatId && (
                <button className="ghost" onClick={() => onOpen(r.lastRun!.chatId)}>{t('Open')}</button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="db-acts">
        <button className="ghost bordered" onClick={onRoutines}><Icon name="clock" size={13} />{t('Routines')}</button>
        <button className="ghost bordered" onClick={onNewChat}><Icon name="chat" size={13} />{t('New chat')}</button>
      </div>
    </div>
  );
}

export default DashboardPanel;
