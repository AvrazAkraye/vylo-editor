// Ask mode.
//
// The claim is that Ask cannot change anything, and the claim is only true
// because the tools are absent from the array — not because the prompt says so.
// So these tests check the array, and they are written to fail if someone adds
// a tool that changes something without deciding which side of the line it goes
// on. A new tool defaults to *neither* list here, and that is caught.
import { READ_TOOLS, WRITE_TOOLS, TOOLS, toolsFor, system } from '../.test-build/agent.js';

let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${name}${detail && !cond ? ' — ' + JSON.stringify(detail) : ''}`);
  cond ? pass++ : fail++;
};

const names = (list) => list.map((t) => t.name).sort();

// The two halves, stated explicitly. Changing this list is the moment to think
// about which side a new tool belongs on.
const READ = ['find_symbol', 'list_tree', 'read_file', 'search'];
const WRITE = ['edit_file', 'remember', 'run_command', 'write_file'];

ok('Ask gets exactly the read-only tools',
   JSON.stringify(names(READ_TOOLS)) === JSON.stringify(READ), names(READ_TOOLS));
ok('and nothing that changes state is among them',
   JSON.stringify(names(WRITE_TOOLS)) === JSON.stringify(WRITE), names(WRITE_TOOLS));

ok('every tool is on exactly one side',
   JSON.stringify(names(TOOLS)) === JSON.stringify([...READ, ...WRITE].sort()), names(TOOLS));
ok('the two halves do not overlap',
   READ_TOOLS.every((r) => !WRITE_TOOLS.some((w) => w.name === r.name)));

// The read tools are the ones a model reaches for constantly, so a broken
// schema here is a broken session rather than a broken feature.
for (const t of TOOLS) {
  ok(`${t.name} has a description and a schema`,
     typeof t.description === 'string' && t.description.length > 20
     && t.input_schema?.type === 'object',
     t);
}

// A tool that stages or runs must never appear in the Ask array, whatever it is
// called. This is the check that survives someone renaming things.
const DANGEROUS = /stage|write|edit|run|exec|command|remember|delete|remove/i;
for (const t of READ_TOOLS) {
  ok(`${t.name} does not describe itself as changing anything`,
     !DANGEROUS.test(t.name),
     t.name);
}

// `apply_write` and the pty commands must not be reachable at all — the whole
// design rests on that, and it is cheap to assert. Every Tauri command that
// writes to a disk, runs a shell, spawns a process or throws something away
// belongs on this list; a command that is absent from it and absent from the
// schema is only absent by luck.
const ABSENT = [
  'apply_write', 'pty_open', 'pty_write', 'pty_resize', 'pty_close',
  'checkpoint_restore', 'checkpoint_redo', 'mcp_start', 'mcp_call',
  'capture_screenshot', 'set_global_shortcut',
  'history_restore', 'history_forget', 'history_forget_all',
  // The filesystem watcher. The frontend subscribes to it; the model has no
  // reason to know the disk moved and no way to ask.
  'watch_start', 'watch_stop',
  // Writes a markdown transcript wherever the OS save panel said. Absent for
  // apply_write's reason: it takes an absolute path and does not contain it,
  // which is safe only while nothing the model produces can reach it.
  'export_write',
  // Writes a Word document from Research wherever the OS save panel said.
  // Absent for export_write's reason: it takes an absolute path and does not
  // contain it, which is safe only while nothing the model produces can reach
  // it. Its guards (.docx only, zip bytes only, 32 MB) narrow what it can
  // write; they do not make it a tool.
  'export_write_docx',
  // Writes the window, printed, as a PDF to the path a save panel returned —
  // Research's Save as PDF. Like export_write_docx, an absolute path is safe
  // here only while nothing the model produces can reach it.
  'save_pdf',
  // Writes a rendered MP4 from the Video module wherever the OS save panel
  // said. Absent for export_write_docx's reason: it takes an absolute path and
  // does not contain it, which is safe only while nothing the model produces
  // can reach it. Its guards (.mp4 only, ftyp bytes only, 1 GiB) narrow what
  // it can write; they do not make it a tool.
  'export_write_video',
  // Selects a file in Finder or Explorer. It opens and writes nothing, but a
  // model that could put windows on the person's screen would be reaching
  // outside the app, which no tool does.
  'reveal_path',
  // The file operations and the git writes. These have been absent from the
  // schema since G1 and M-whatever respectively, and until now they were absent
  // by nobody's decision — no test said they had to be. `create_file`'s own doc
  // comment in lib.rs claims "**Human action only**, like every other write:
  // absent from the tool schema", and this is the line that makes that true
  // rather than merely currently-the-case. `delete_path` calls
  // `fs::remove_dir_all`, which is the most destructive thing in the app.
  'create_file', 'create_dir', 'rename_path', 'delete_path',
  'git_create_branch', 'git_commit',
  // Writes an unsaved buffer to app data as you type, and clears drafts.
  //
  // `draft_clear` is here because it deletes a folder's whole draft directory
  // (`fs::remove_dir_all` in drafts.rs) and `checkpoint_save` because it writes
  // there -- both meet the description at the top of this list, and both were
  // absent from the schema by nobody's decision until this line. The comment on
  // `checkpoint_save` in lib.rs already claims it is "absent from the tool
  // schema"; this is what makes that true rather than merely currently-the-case.
  'draft_save', 'draft_clear', 'checkpoint_save',
  // The Storage tab in Settings. `store_empty` calls `fs::remove_dir_all` on
  // one of the three directories in the app data folder, which is the most
  // destructive thing in this app after `delete_path` -- it takes a closed
  // enum rather than a path for exactly that reason, and it is here because a
  // command that throws a whole store away must not be reachable by a tool
  // call however the model is prompted. `store_sizes` only measures, and is
  // here for `hide_traffic_lights`'s reason: a command is absent from the
  // schema by somebody's decision rather than by nobody having made one.
  'store_empty', 'store_sizes',
  // Stops a third-party server. Starting one is already here; stopping one is
  // the same authority in the other direction.
  'mcp_stop',
  // The two reads that sit OUTSIDE `resolve()`. They take a raw absolute path
  // and are safe only because the human picked the file in a drop or a picker,
  // which their own doc comments in lib.rs say. That is a different reason from
  // the rest of this list -- they throw nothing away -- but it fails the same
  // way: a model-supplied path reaching either of them is containment gone,
  // silently. SAFETY.md enumerates exactly these two as the containment
  // exceptions; this is the line that keeps that enumeration true.
  'read_image', 'read_document', 'read_text_attachment',
  // Hides three buttons on a window so the app can draw its own. There is
  // nothing here a model needs and nothing it could do with it — but the rule
  // this list exists for is that a command is absent from the schema by
  // somebody's decision, not by nobody having thought about it.
  'hide_traffic_lights',
  // The Storage tab. `store_empty` calls `fs::remove_dir_all` on a whole store,
  // which makes it the most destructive command added since `delete_path`. It
  // is contained by *type* rather than by a check — it takes a `LocalStore`
  // enum whose `dir()` returns a fixed string, so there is no caller-supplied
  // path for anything to reach. That is the right design and it is still not a
  // reason to leave it off this list: the rule is that a command is absent from
  // the schema by somebody's decision. `store_sizes` only reads, and is here
  // because knowing how much a person keeps is not the agent's business either.
  'store_empty', 'store_sizes',
  // Runs `git diff` twice to size the working tree for the status bar. It
  // reads and it throws nothing away, so it is not `apply_write` — but it
  // spawns a process, which is the description at the top of this list, and
  // the model has `run_command` and a human approval if it ever needs the
  // number. Absent by a decision rather than by nobody having made one.
  'git_diffstat',
];
// `run_command` is deliberately NOT on this list. It is IN the schema, and that
// is the whole design: the model may ask, and a human approves the exact string
// before anything runs. A gate you can see is not the same as a missing one.
for (const forbidden of ABSENT) {
  ok(`${forbidden} is absent from the schema`, !TOOLS.some((t) => t.name === forbidden));
}

// ── Chat mode: the sandbox is the absence ─────────────────────────────────
// A model with the repository in its prompt answers about the repository
// whether or not it was asked to. Chat carries nothing: no tools, no
// environment block, no memory — so it cannot claim to have read a file.
ok('chat mode sends no project or MCP tools', toolsFor({ mode: 'chat', extraTools: [{ name: 'x' }, { name: 'mcp__s__write' }] }).length === 0);
{
  const wa = [{ name: 'whatsapp_chats' }, { name: 'whatsapp_read' }, { name: 'whatsapp_send' }];
  const names = toolsFor({ mode: 'chat', extraTools: [{ name: 'x' }, ...wa] }).map((t) => t.name);
  ok('but WhatsApp, when connected, is offered in chat — and nothing else', names.join() === 'whatsapp_chats,whatsapp_read,whatsapp_send', names.join());
  ok('the chat prompt says so only when it is connected',
     system({ mode: 'chat', extraTools: wa }).includes('whatsapp_send') && !system({ mode: 'chat' }).includes('whatsapp_send'));
}
ok('not even the read tools', (() => {
  const names = toolsFor({ mode: 'chat' }).map((t) => t.name);
  return !READ_TOOLS.some((t) => names.includes(t.name));
})());
ok('ask mode still sends exactly the read tools', (() => {
  const names = toolsFor({ mode: 'ask' }).map((t) => t.name).sort().join();
  return names === READ_TOOLS.map((t) => t.name).sort().join();
})());
ok('agent mode sends everything plus extras', toolsFor({ mode: 'agent', extraTools: [{ name: 'mcp__x' }] }).length === TOOLS.length + 1);
{
  const env = 'ENVIRONMENT-FACTS-MARKER';
  const mem = 'MEMORY-MARKER';
  const chat = system({ mode: 'chat', environment: env, memory: mem });
  ok('chat mode drops the project environment from the prompt', !chat.includes(env));
  ok('and the memory', !chat.includes(mem));
  ok('and says it is a conversation not tied to a project', /not tied to a project/i.test(chat));
  const ask = system({ mode: 'ask', environment: env, memory: mem });
  ok('ask mode keeps both, as before', ask.includes(env) && ask.includes(mem));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
