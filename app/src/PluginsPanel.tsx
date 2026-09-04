import { Icon } from './Icon';
import { commandLine, isEnabled, type McpTool, type ServerSpec } from './mcp';

/**
 * Plugins: the services attached to the agent.
 *
 * BridgeMind calls them plugins; here they have always been MCP servers, and
 * they have lived in Settings → Modules since the day they arrived — which is
 * where somebody goes to *configure* a thing, not to *see* it. A rail module
 * is where you look while working: which services are on, what each offers,
 * and the one fact worth reading before anything else — the command that will
 * run when you enable one.
 *
 * Nothing starts from this panel except by the button, after the command is on
 * screen. The config arrives with the repository, so a clone could name any
 * command; that is why the rule is the same here as in Settings.
 */

interface Props {
  root: string;
  t: (s: string) => string;
  servers: ServerSpec[];
  tools: Record<string, McpTool[]>;
  error: string | null;
  onToggle: (s: ServerSpec) => void;
  onSettings: () => void;
}

export function PluginsPanel({ root, t, servers, tools, error, onToggle, onSettings }: Props) {
  return (
    <div className="pg">
      {error && <p className="mcp-err">{error}</p>}
      {servers.length === 0 && !error && (
        <div className="pg-none">
          <p className="ft-empty">{root ? t('No plugins declared in this project.') : t('No folder')}</p>
          <p className="ft-empty todo-where">{t('Declare one in .vylo/mcp.json, in the same shape Claude Desktop uses.')}</p>
        </div>
      )}
      <ul className="pg-list">
        {servers.map((sv) => {
          const on = isEnabled(root, sv);
          const list = tools[sv.name];
          return (
            <li key={sv.name} className={`pg-row ${on ? 'on' : ''}`}>
              <div className="pg-what">
                <b><Icon name="branch" size={12} />{sv.name}</b>
                {/* The exact command, before the button that runs it. */}
                <code>{commandLine(sv)}</code>
                {on && list && (
                  <span className="pg-tools">
                    {list.slice(0, 6).map((x) => <em key={x.name}>{x.name}</em>)}
                    {list.length > 6 && <em>+{list.length - 6}</em>}
                  </span>
                )}
              </div>
              <button className={on ? 'ghost' : 'approve'} onClick={() => onToggle(sv)}>
                {on ? t('Disable') : t('Enable')}
              </button>
            </li>
          );
        })}
      </ul>
      <button className="ghost pg-more" onClick={onSettings}>
        <Icon name="settings" size={12} />{t('Approval and modules')}
      </button>
    </div>
  );
}

export default PluginsPanel;
