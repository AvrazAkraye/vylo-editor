// MCP naming and the enablement fingerprint.
//
// The fingerprint is the security-relevant part: it is what an approval is
// stored against, so it has to change whenever the thing being approved does.
// If it did not, editing `.vylo/mcp.json` in a repository would inherit an
// approval a human gave for a different command.
import { commandLine, fingerprint, splitTool, toolName, toSchema } from '../.test-build/mcp.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};
const spec = (o) => ({ name: 'x', command: 'npx', args: ['-y', 'pkg'], env: {}, ...o });

// ── namespacing ───────────────────────────────────────────────────────────
ok('a tool is namespaced by its server', toolName('pg', 'query') === 'mcp__pg__query');
{
  const s = splitTool('mcp__pg__query');
  ok('and splits back apart', s?.server === 'pg' && s?.tool === 'query', s);
}
ok('a tool name containing __ survives the round trip',
   splitTool(toolName('pg', 'run__raw'))?.tool === 'run__raw', splitTool(toolName('pg', 'run__raw')));
ok('one of our own tools is not an MCP tool', splitTool('read_file') === null);
ok('a malformed namespaced name is rejected', splitTool('mcp__nope') === null);

// ── the fingerprint ───────────────────────────────────────────────────────
ok('the same command fingerprints the same', fingerprint(spec()) === fingerprint(spec()));
ok('a different command asks again',
   fingerprint(spec()) !== fingerprint(spec({ command: 'sh' })));
ok('different arguments ask again',
   fingerprint(spec()) !== fingerprint(spec({ args: ['-y', 'other'] })));
ok('argument order matters',
   fingerprint(spec({ args: ['a', 'b'] })) !== fingerprint(spec({ args: ['b', 'a'] })));
ok('a new environment variable asks again',
   fingerprint(spec()) !== fingerprint(spec({ env: { TOKEN: 'x' } })));
ok('but rotating a secret does not, since the command is unchanged',
   fingerprint(spec({ env: { TOKEN: 'old' } })) === fingerprint(spec({ env: { TOKEN: 'new' } })));
ok('env order does not matter',
   fingerprint(spec({ env: { A: '1', B: '2' } })) === fingerprint(spec({ env: { B: '2', A: '1' } })));
ok('renaming the server does not change what would run',
   fingerprint(spec({ name: 'a' })) === fingerprint(spec({ name: 'b' })));

// ── what the human is shown ───────────────────────────────────────────────
ok('the command line reads as it would be run',
   commandLine(spec()) === 'npx -y pkg', commandLine(spec()));

// ── the schema handed to the model ────────────────────────────────────────
{
  const t = toSchema('pg', { name: 'query', description: 'Run SQL', input_schema: { type: 'object' } });
  ok('the schema is namespaced', t.name === 'mcp__pg__query');
  ok('the description names the server, so two servers are distinguishable',
     t.description === '[pg] Run SQL', t.description);
  ok('the input schema is carried through', t.input_schema.type === 'object');
}
{
  // Servers vary between input_schema and inputSchema; both must work.
  const t = toSchema('a', { name: 'b', inputSchema: { type: 'object', properties: { q: {} } } });
  ok('camelCase inputSchema is accepted', t.input_schema.properties.q !== undefined, t.input_schema);
  const bare = toSchema('a', { name: 'b' });
  ok('a tool with no schema still gets a valid one', bare.input_schema.type === 'object', bare);
  ok('and falls back to its name for a description', bare.description === '[a] b', bare.description);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
