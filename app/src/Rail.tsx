import { Icon } from './Icon';
import type { IconName } from './Icon';
import type { ModuleId } from './modules';

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

/**
 * What the rail draws.
 *
 * The ids live in `modules.ts` rather than here. They used to be declared in
 * this file and copied into App.tsx's item array and again into the sidebar's
 * heading chain, and the copies drifted — which is how the To do panel spent
 * eleven releases under a heading that said "Memory".
 */
export interface RailItem {
  id: ModuleId;
  icon: IconName;
  label: string;
  /** A number badges the icon; anything else is ignored. */
  badge?: number;
}

interface Props {
  items: RailItem[];
  active: ModuleId;
  /**
   * The module showing in the *other* sidebar, if it is open. Lit alongside
   * `active`, because two panels are on screen and both icons should say so.
   */
  alsoOn?: ModuleId | null;
  /** True when the panel is hidden and only the rail shows. */
  collapsed: boolean;
  onSelect: (id: ModuleId) => void;
  /** A right-click on an icon: dock it on the other side, or turn it off. */
  onMenu?: (id: ModuleId, at: { x: number; y: number }) => void;
  settings: () => void;
  settingsLabel: string;
  /** The rail is navigation, so it needs a name in the language in use. */
  label: string;
}

export function Rail({ items, active, alsoOn = null, collapsed, onSelect, onMenu, settings, settingsLabel, label }: Props) {
  return (
    <nav className="rail" aria-label={label}>
      {items.map((it) => (
        <button
          key={it.id}
          className={`rail-btn ${!collapsed && it.id === active ? 'on' : ''} ${it.id === alsoOn ? 'on alt' : ''}`}
          onClick={() => onSelect(it.id)}
          onContextMenu={(e) => { if (onMenu) { e.preventDefault(); onMenu(it.id, { x: e.clientX, y: e.clientY }); } }}
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
