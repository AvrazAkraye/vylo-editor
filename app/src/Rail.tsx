import { Icon, type IconName } from './Icon';

/**
 * The activity rail.
 *
 * The sidebar used to stack five accordion sections in one column, which meant
 * the explorer — the one people look at constantly — was pushed down the page
 * by whatever else happened to be open, and its height changed every time
 * something else was toggled. A rail fixes the position of everything: the
 * chooser never moves, and the panel below it always starts at the top.
 *
 * Selecting the section you are already on collapses the sidebar, which is how
 * VS Code and Cursor behave and is the fastest way to get the width back.
 */

export type RailId = 'files' | 'search' | 'changes' | 'chats' | 'todo' | 'memory';

export interface RailItem {
  id: RailId;
  icon: IconName;
  label: string;
  /** A number badges the icon; anything else is ignored. */
  badge?: number;
}

interface Props {
  items: RailItem[];
  active: RailId;
  /** True when the panel is hidden and only the rail shows. */
  collapsed: boolean;
  onSelect: (id: RailId) => void;
  settings: () => void;
  settingsLabel: string;
  /** The rail is navigation, so it needs a name in the language in use. */
  label: string;
}

export function Rail({ items, active, collapsed, onSelect, settings, settingsLabel, label }: Props) {
  return (
    <nav className="rail" aria-label={label}>
      {items.map((it) => (
        <button
          key={it.id}
          className={`rail-btn ${!collapsed && it.id === active ? 'on' : ''}`}
          onClick={() => onSelect(it.id)}
          title={it.label}
          aria-label={it.label}
          aria-current={!collapsed && it.id === active ? 'page' : undefined}
        >
          <Icon name={it.icon} size={19} />
          {it.badge ? <span className="rail-badge">{it.badge > 99 ? '99+' : it.badge}</span> : null}
        </button>
      ))}
      <span className="rail-sp" />
      <button className="rail-btn" onClick={settings} title={settingsLabel} aria-label={settingsLabel}>
        <Icon name="settings" size={19} />
      </button>
    </nav>
  );
}
