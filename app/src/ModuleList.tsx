import { Icon } from './Icon';
import { useReorder } from './useReorder';
import {
  DEFAULT, dock, dockOf, isLast, isOn, moduleOf, moveTo, reset, setSide, toggle,
  type Layout, type ModuleId, type Side,
} from './modules';

/**
 * The app's own sections, listed so they can be rearranged.
 *
 * Every module is shown, switched off ones included, because a list that hides
 * what you turned off has no way to turn it back on — and because dragging past
 * a hidden row would land somewhere other than where the eye says.
 *
 * The reorder hook is the one the terminal rail and the chat list already use,
 * so a drag feels the same in all three places rather than being invented a
 * third time.
 */

interface Props {
  layout: Layout;
  onChange: (next: Layout) => void;
  t: (s: string) => string;
}

/**
 * Which edge the rail sits against.
 *
 * Two buttons rather than a dropdown: there are two answers, and a select with
 * two options is a click and then a second click to say what you could have
 * said in one.
 */
export function RailSide({ layout, onChange, t }: Props) {
  return (
    <span className="tk-pills">
      {(['left', 'right'] as Side[]).map((side) => (
        <button key={side} className={`tk-pill ${layout.side === side ? 'on' : ''}`}
                aria-pressed={layout.side === side}
                onClick={() => onChange(setSide(layout, side))}>
          {t(side === 'left' ? 'Left' : 'Right')}
        </button>
      ))}
    </span>
  );
}

export function ModuleList({ layout, onChange, t }: Props) {
  const drag = useReorder({
    axis: 'y',
    onMove: (from, to) => onChange(moveTo(layout, from, to)),
  });

  // Against how it *ships*, not against everything-on: most modules start off
  // now, so `off.length > 0` would offer a Reset to somebody who has never
  // changed anything — and pressing it would appear to do nothing.
  const same = (a: readonly string[], b: readonly string[]) =>
    [...a].sort().join() === [...b].sort().join();
  const arranged = layout.order.join() !== DEFAULT.order.join()
    || !same(layout.off, DEFAULT.off)
    || layout.side !== DEFAULT.side
    || layout.right.length > 0;

  return (
    <div className="mod">
      <div {...drag.strip} className={`mod-list ${drag.strip.className}`}>
        {layout.order.map((id: ModuleId, i) => {
          const m = moduleOf(id);
          const on = isOn(layout, id);
          const last = isLast(layout, id);
          return (
            <div key={id} className={`mod-row ${on ? 'on' : ''} ${drag.itemClass(i)}`}>
              <span className="mod-grip" aria-hidden="true"><Icon name="ellipsis" size={13} turn={90} /></span>
              <span className="mod-icon"><Icon name={m.icon} size={15} /></span>
              <span className="mod-what">
                <b>{t(m.label)}</b>
                <span>{t(m.about)}</span>
              </span>
              {/* Disabled rather than hidden on the last one: a control that
                  vanishes leaves somebody wondering what they did, and one
                  that explains itself teaches the rule in a tooltip. */}
              {/* Which sidebar it opens in. A second sidebar is a panel on each
                  side of the work, so this is per module, not one switch. */}
              <button className={`mod-dock ${dockOf(layout, id) === 'other' ? 'on' : ''}`} data-nodrag
                      aria-pressed={dockOf(layout, id) === 'other'}
                      title={t(dockOf(layout, id) === 'other' ? 'Show beside the rail' : 'Show on the other side')}
                      onClick={() => onChange(dock(layout, id, dockOf(layout, id) === 'other' ? 'rail' : 'other'))}>
                <Icon name="split" size={13} />
              </button>
              <button className={`mod-sw ${on ? 'on' : ''}`} data-nodrag
                      role="switch" aria-checked={on} disabled={last}
                      title={last ? t('At least one section has to stay on.') : undefined}
                      onClick={() => onChange(toggle(layout, id))}
                      aria-label={`${t(m.label)} — ${on ? t('On') : t('Off')}`}>
                <i aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>

      <div className="mod-foot">
        <p>{t('Drag to reorder. The rail follows this list.')}</p>
        {arranged && (
          <button className="ghost" onClick={() => onChange(reset())}>{t('Reset')}</button>
        )}
      </div>
    </div>
  );
}

export default ModuleList;
