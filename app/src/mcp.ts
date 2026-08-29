import { invoke } from '@tauri-apps/api/core';

/**
 * MCP servers, from the project's `.vylo/mcp.json`.
 *
 * The config travels with the repository, so a project you cloned can name any
 * command. Nothing here starts anything until a human has read that command and
 * enabled it, and the approval is stored against a fingerprint of the command —
 * so editing the config asks again rather than inheriting the old answer.
 */

export interface ServerSpec {
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
}

export interface McpTool {
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
  inputSchema?: Record<string, unknown>;
}

/** Namespaced, so an MCP tool can never shadow one of ours. */
export const NS = 'mcp__';
export const toolName = (server: string, tool: string) => `${NS}${server}__${tool}`;

/** Split a namespaced name back apart. Null when it is one of our own tools. */
export function splitTool(name: string): { server: string; tool: string } | null {
  if (!name.startsWith(NS)) return null;
  const rest = name.slice(NS.length);
  const cut = rest.indexOf('__');
  if (cut <= 0) return null;
  return { server: rest.slice(0, cut), tool: rest.slice(cut + 2) };
}

/**
 * What the human is agreeing to when they enable a server.
 *
 * Mirrors the Rust side: the command, its arguments, and the *names* of the
 * environment variables — not their values, which are usually secrets and
 * change without the thing being run changing.
 */
export function fingerprint(s: ServerSpec): string {
  const env = Object.keys(s.env ?? {}).sort().map((k) => ` env:${k}`).join('');
  return `${s.command}${(s.args ?? []).map((a) => ` ${a}`).join('')}${env}`;
}

export const commandLine = (s: ServerSpec) => [s.command, ...(s.args ?? [])].join(' ');

const KEY = 'vylo.mcp.enabled';

/** `${root} ${name}` -> the fingerprint that was approved. */
type Enabled = Record<string, string>;

function read(): Enabled {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') as Enabled; } catch { return {}; }
}

export function isEnabled(root: string, s: ServerSpec): boolean {
  return read()[`${root} ${s.name}`] === fingerprint(s);
}

export function setEnabled(root: string, s: ServerSpec, on: boolean): void {
  const all = read();
  const key = `${root} ${s.name}`;
  if (on) all[key] = fingerprint(s); else delete all[key];
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch { /* private mode */ }
}

export function listServers(root: string): Promise<ServerSpec[]> {
  return invoke<ServerSpec[]>('mcp_servers', { root });
}

export function startServer(root: string, spec: ServerSpec): Promise<McpTool[]> {
  return invoke<McpTool[]>('mcp_start', { root, spec });
}

export function stopServer(name: string): Promise<void> {
  return invoke('mcp_stop', { name });
}

export function callTool(server: string, tool: string, args: unknown): Promise<string> {
  return invoke<string>('mcp_call', { server, tool, args });
}

/**
 * An MCP tool as the model should see it.
 *
 * The description carries the server name because the model chooses between
 * tools by reading these, and "query" from two different servers is otherwise
 * the same tool twice.
 */
export function toSchema(server: string, t: McpTool) {
  const schema = t.input_schema ?? t.inputSchema ?? { type: 'object', properties: {} };
  return {
    name: toolName(server, t.name),
    description: `[${server}] ${t.description ?? t.name}`,
    input_schema: schema,
  };
}
