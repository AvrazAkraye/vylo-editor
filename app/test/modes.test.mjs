// Ask mode.
//
// The claim is that Ask cannot change anything, and the claim is only true
// because the tools are absent from the array — not because the prompt says so.
// So these tests check the array, and they are written to fail if someone adds
// a tool that changes something without deciding which side of the line it goes
// on. A new tool defaults to *neither* list here, and that is caught.
import { READ_TOOLS, WRITE_TOOLS, TOOLS } from '../.test-build/agent.js';

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
  'draft_save',
  // Stops a third-party server. Starting one is already here; stopping one is
  // the same authority in the other direction.
  'mcp_stop',
];
// `run_command` is deliberately NOT on this list. It is IN the schema, and that
// is the whole design: the model may ask, and a human approves the exact string
// before anything runs. A gate you can see is not the same as a missing one.
for (const forbidden of ABSENT) {
  ok(`${forbidden} is absent from the schema`, !TOOLS.some((t) => t.name === forbidden));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
