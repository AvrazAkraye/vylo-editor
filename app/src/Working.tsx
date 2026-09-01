import { useEffect, useState } from 'react';
import { Icon } from './Icon';
import { elapsed, isSlow, line, type Progress } from './progress';

/**
 * The line shown while a turn is running, and what is under it.
 *
 * Closed, it is one sentence and a duration — which is what somebody glancing
 * at the screen wants, and is already more than the word "working…" it
 * replaces. Open, it is the figures that explain why a turn is taking as long
 * as it is: which round-trip, how many tools, how much has been written, how
 * full the context is.
 *
 * The clock only ticks while a turn is running. A `setInterval` left going for
 * the life of the window would re-render the transcript once a second forever,
 * for a number nobody is looking at.
 */

interface Props {
  progress: Progress;
  t: (s: string) => string;
  /** Ask or Agent, already translated. */
  mode: string;
  /** The model's short name — "Opus 5", not the id. */
  model: string;
  /** How full the context is, 0–100, or null before the first request. */
  context: number | null;
  /** Stop the turn. The same action as the composer's stop button. */
  onStop?: () => void;
}

export function Working({ progress, t, mode, model, context, onStop }: Props) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (progress.phase === 'idle') return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [progress.phase === 'idle']);

  // Closing on its own when the turn ends would hide the panel at the moment
  // somebody opened it to find out why the turn was long. It stays open, and
  // the parent stops rendering this when the turn is gone.
  if (progress.phase === 'idle') return null;

  const l = line(progress);
  const waiting = progress.phase === 'waiting';
  const hint = isSlow(progress, now);

  return (
    <div className={`line working wk ${waiting ? 'wk-wait' : ''} ${open ? 'wk-open' : ''}`}>
      <button className="wk-row" onClick={() => setOpen(!open)} aria-expanded={open}
              title={t('What it is doing')}>
        <span className="dot" aria-hidden="true" />
        <span className="wk-say">
          {l.text && t(l.text)}
          {l.detail && <b className={l.mono ? 'mono' : ''}>{l.detail}</b>}
        </span>
        <span className="wk-time">{elapsed(progress.since, now)}</span>
        {/* The chevron appears once a turn has gone on long enough to be worth
            explaining. Before that it is a control nobody needs, on a line that
            is about to disappear. */}
        <Icon name="chevron" size={12} turn={open ? 180 : 0}
              className={hint || open ? 'wk-more on' : 'wk-more'} />
      </button>

      {open && (
        <dl className="wk-facts">
          <div><dt>{t('Mode')}</dt><dd>{mode}</dd></div>
          <div><dt>{t('Model')}</dt><dd>{model}</dd></div>
          {/* Round-trips are the figure that explains a long turn: reading six
              files is six requests, and each one is billed. */}
          <div><dt>{t('Round-trip')}</dt><dd>{progress.hop} / {progress.maxHops}</dd></div>
          {progress.ran > 0 && <div><dt>{t('Tools run')}</dt><dd>{progress.ran}</dd></div>}
          {progress.written > 0 && (
            <div><dt>{t('Written')}</dt><dd>{progress.written.toLocaleString()}</dd></div>
          )}
          {context !== null && <div><dt>{t('Context')}</dt><dd>{context}%</dd></div>}
          {progress.tool && (
            <div className="wk-wide"><dt>{t('Tool')}</dt><dd className="mono">{progress.tool}</dd></div>
          )}
          {waiting && (
            <p className="wk-why">{t('Nothing is running. It is waiting for you to answer.')}</p>
          )}
          {onStop && !waiting && (
            <button className="ghost wk-stop" onClick={onStop}>
              <Icon name="stop" size={12} />{t('Stop')}
            </button>
          )}
        </dl>
      )}
    </div>
  );
}

export default Working;
