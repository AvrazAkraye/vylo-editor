import { useState } from 'react';
import { Icon } from './Icon';
import { fill } from './i18n';
import { sections, tally, type Card, type Status } from './fleet';

/**
 * The agents dashboard: every terminal running an agent, and what it is doing.
 *
 * Drawn in place of the panes rather than beside them, because it answers a
 * different question — not "what is this one printing" but "which of these
 * needs me" — and at the moment somebody asks that, the panes are what they
 * are trying to see past. The terminals stay mounted underneath: an agent is a
 * process that keeps running whether or not its pane is drawn, and this view
 * would be useless if opening it stopped anything.
 *
 * Everything here is derived from the cards it is handed; it keeps only which
 * filter is chosen. See fleet.ts for how a card's status is decided.
 */

interface Props {
  cards: readonly Card[];
  t: (s: string) => string;
  /** Show this session's terminal, and leave the dashboard. */
  onOpen: (id: string) => void;
}

type Filter = Status | 'all';

export function FleetView({ cards, t, onOpen }: Props) {
  const [only, setOnly] = useState<Filter>('all');
  const n = tally(cards);
  const shown = sections(cards, only);

  const said = (s: Status) => (s === 'needs' ? t('Needs you') : s === 'working' ? t('Working') : t('Idle'));

  if (!cards.length) {
    return (
      <div className="fleet fleet-empty">
        <Icon name="board" size={22} />
        <p><b>{t('No agents running.')}</b></p>
        {/* Named rather than described, because the list of what counts is
            short and a person scanning this wants the command, not a category. */}
        <p>{t('Start claude, codex or gemini in a terminal and it appears here, with whether it is working, idle or waiting for you.')}</p>
      </div>
    );
  }

  // The bar is the tally drawn to scale. Needs-you first, on the same logic
  // as the sections: it is the part of the bar that is waiting on the reader.
  const pct = (k: number) => `${(k / n.all) * 100}%`;

  return (
    <div className="fleet">
      <div className="fleet-head">
        <span className="fleet-n">{n.all}</span>
        <span className="fleet-what">
          <b>{n.all === 1 ? t('agent') : t('agents')}</b>
          <span>
            {[
              n.needs ? fill(t('{n} need you'), { n: n.needs }) : '',
              fill(t('{n} working'), { n: n.working }),
              fill(t('{n} idle'), { n: n.idle }),
            ].filter(Boolean).join(' · ')}
          </span>
        </span>
      </div>

      <div className="fleet-bar" role="img"
           aria-label={fill(t('{w} of {n} agents working'), { w: n.working, n: n.all })}>
        {n.needs > 0 && <i className="needs" style={{ inlineSize: pct(n.needs) }} />}
        {n.working > 0 && <i className="working" style={{ inlineSize: pct(n.working) }} />}
        {n.idle > 0 && <i className="idle" style={{ inlineSize: pct(n.idle) }} />}
      </div>

      <div className="fleet-chips" role="group" aria-label={t('Show')}>
        {(['all', 'needs', 'working', 'idle'] as const).map((f) => {
          const count = f === 'all' ? n.all : n[f];
          return (
            <button key={f} className={`fleet-chip ${f} ${only === f ? 'on' : ''}`}
                    aria-pressed={only === f} onClick={() => setOnly(f)}>
              {f !== 'all' && <i aria-hidden="true" />}
              {f === 'all' ? t('All') : said(f)}
              <span>{count}</span>
            </button>
          );
        })}
      </div>

      {shown.length === 0 && (
        <p className="fleet-none">{fill(t('Nothing is {state} right now.'), { state: said(only as Status).toLowerCase() })}</p>
      )}

      {shown.map((sec) => (
        <section key={sec.status} className={`fleet-sec ${sec.status}`}>
          <h4><i aria-hidden="true" />{said(sec.status)}<span>{sec.cards.length}</span></h4>
          <div className="fleet-grid">
            {sec.cards.map((c) => (
              <button key={c.id} className={`fleet-card ${c.status}`} onClick={() => onOpen(c.id)}
                      title={t('Show this terminal')}>
                <span className="fleet-mark">
                  <Icon name={/claude/i.test(c.agent) ? 'claude' : 'terminal'} size={15} />
                  <i aria-hidden="true" />
                </span>
                <span className="fleet-text">
                  <b dir="auto">{c.title}</b>
                  <span>{c.agent}{c.where ? ` · ${c.where}` : ''}</span>
                </span>
                <span className={`fleet-pill ${c.status}`}>{said(c.status)}</span>
              </button>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
