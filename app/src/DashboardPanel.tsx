import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { fill } from './i18n';
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
}

export function DashboardPanel({ t, routines, agents, missed, onRun, onOpen, onRoutines, onNewChat }: Props) {
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
  const failed = recent.filter((r) => r.lastRun && !r.lastRun.ok).length;
  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id;
  const ago = (at: number) => {
    const m = Math.max(0, Math.round((now - at) / 60_000));
    return m < 1 ? t('Just now') : m < 60 ? fill(t('{n} minutes ago'), { n: m })
      : m < 1440 ? fill(t('{n} hours ago'), { n: Math.round(m / 60) }) : fill(t('{n} days ago'), { n: Math.round(m / 1440) });
  };
  const inWhen = (at: number) => {
    const m = Math.max(0, Math.round((at - now) / 60_000));
    return m < 1 ? t('Due now') : m < 60 ? fill(t('In {n} minutes'), { n: m }) : fill(t('In {n} hours'), { n: Math.round(m / 60) });
  };

  return (
    <div className="db">
      <div className="db-facts">
        <div><b>{agents.length}</b><span>{agents.length === 1 ? t('agent') : t('agents')}</span></div>
        <div><b>{routines.filter((r) => !r.paused).length}</b><span>{t('on a schedule')}</span></div>
        <div className={failed ? 'bad' : ''}><b>{failed}</b><span>{t('failed')}</span></div>
      </div>

      {missed.length > 0 && (
        <div className="db-missed">
          <Icon name="warning" size={12} />
          <span>{fill(t('{n} runs were due while the app was closed and were skipped.'), { n: missed.length })}</span>
        </div>
      )}

      <div className="sb-sub">{t('Up next')}</div>
      {upcoming.length === 0 ? (
        <p className="ft-empty">{t('Nothing scheduled.')}</p>
      ) : (
        <ul className="db-list">
          {upcoming.map(({ r, at }) => {
            const ph = phrase(r.schedule);
            return (
              <li key={r.id} className="db-row">
                <span className="db-what">
                  <b>{r.name}</b>
                  <span>{agentName(r.agent)} · {fill(t(ph.key), { ...ph.vars, day: typeof ph.vars.day === 'string' ? t(ph.vars.day) : '' })}</span>
                </span>
                {/* A run the scheduler is holding says why, in place of a "Due
                    now" that would otherwise sit there unexplained. */}
                <em>{r.held && at <= now ? r.held : inWhen(at)}</em>
                <button className="todo-act" onClick={() => onRun(r)} title={t('Run now')} aria-label={`${t('Run now')} — ${r.name}`}><Icon name="play" size={12} /></button>
              </li>
            );
          })}
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
                <span>{r.lastRun!.ok ? ago(r.lastRun!.at) : (r.lastRun!.error || t('Failed'))}</span>
              </span>
              <button className="ghost" onClick={() => onOpen(r.lastRun!.chatId)}>{t('Open')}</button>
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
