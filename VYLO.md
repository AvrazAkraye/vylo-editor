# Project memory

Notes Vylo Editor carries into every chat in this project.

## What this is

A Tauri v2 desktop app (macOS + Windows) that runs a coding agent against a
folder on the user's own machine. The Rust side is the tool layer; the React
side is the UI and the agent loop. Model calls go to the Vylo gateway at
`capi.vylo-tech.com`, never to Anthropic directly.

## The rule the whole design rests on

**No model output reaches disk or a shell without a human having read and
approved that exact content or string.**

That is the precise form. It is about who *authors* a change, not about routing
every write through review — which is why the memory editor, the terminal and
(since 0.7.0) the code editor are all consistent with it: in each, the human is
the author, and approving your own keystrokes is theatre.

The mechanism: `write_file`, `edit_file` and
`remember` stage a result for human review; `run_command` suspends the loop
until a human approves the exact string. The Rust commands that actually touch
the disk (`apply_write`) or run a shell (`run_command`) are **absent from the
tool schema**, so they cannot be reached by a tool call however the model is
prompted.

Keep it that way. If you add a capability, add it as a staged proposal, not as a
direct action — and put it on one side of the `READ_TOOLS` / `WRITE_TOOLS`
split in `agent.ts`, which is what Ask mode is built on. `test/modes.test.mjs`
names both halves so a new tool cannot quietly join neither.

### Where the editor sits inside that rule

`app/src/Editor.tsx` lets a person edit and save directly, and `Viewer.tsx` —
which argued editing would be "a second, silent way for files to change" — is
gone. What editing genuinely creates is a *collision*: a human changing the same
file the agent has a diff staged against.

That is handled, not avoided. `apply_write` takes `expect_sha256` and refuses a
write when the file has moved since the change was prepared; `Pending.apply()`
passes the hash of `before`, and the review pane re-bases the diff on the
current file so the conflict is visible rather than resolved behind your back.
`Pending.currentContent` resolves staged → unsaved buffer → disk, so the agent
reads what you are looking at instead of a stale copy.

Open files stay mounted while their tab is hidden. Unmounting would throw away
unsaved edits and the undo history with them.

### Where MCP sits inside that rule

`.vylo/mcp.json` lives in the *project*, so it arrives with the project. A
repository you cloned can name any command, and a client that reads that file
and starts what it says is a way to run a stranger's code by opening their
folder — which is why Claude Desktop keeps its config user-global.

So reading the config starts nothing. A server spawns only from a button, after
its exact command is on screen, and the approval is stored against a fingerprint
of that command so editing the config asks again. Every MCP *tool call* then
goes through the same gate as `run_command`: the tools are third-party code
whose side effects nothing about their names reveals.

`mcp_start` and `mcp_call` are absent from the tool schema, like `apply_write`.

### Where the terminal sits inside that rule

The integrated terminal (`src-tauri/src/pty.rs`) runs a real shell with no
approval step, and that does not weaken the rule: the rule is about who is
*authoring* the command. A human typing into a shell on their own machine could
open the same shell in Terminal.app; asking them to approve their own keystrokes
would be theatre, exactly as it is in the memory editor.

What holds the line is that `pty_open` / `pty_write` / `pty_resize` /
`pty_close` are **absent from the tool schema**, and nothing carries text from
the model into a terminal. The bridge is one-way: a human can press *Send to
chat* to hand terminal output to the agent. Do not add the reverse.

## Containment

Every path the model supplies is resolved with `canonicalize` against the open
folder and rejected if it escapes — `..` and symlinks resolve rather than being
pattern-matched. `read_image` is the one deliberate exception: a human dragging
a file in has chosen it explicitly.

## Commands

- `npm run build` — typecheck and bundle the frontend
- `npm test` — diff, SSE assembly and fuzzy ranking (37)
- `cd src-tauri && cargo test` — 9, including the stale-write guard
- `npx tauri build` — produces the `.app` and `.dmg`

Release macOS with `scripts/publish-macos.sh`, which carries the checks a plain
build does not. Releases and the signing key are documented in
`docs/RELEASING.md`. Windows
binaries cannot be built on a Mac; they come from CI.

## Theming

Three states, not two. `system` stores `system` and stamps **no** `data-theme`,
so CSS resolves through `prefers-color-scheme` and keeps following the OS after
launch. Every token is defined on bare `:root` first; the dark values are
repeated in `@media (prefers-color-scheme: dark){ :root:not([data-theme=light]) }`
and again in `:root[data-theme="dark"]` so the toggle wins in both directions.

`--brand` is the accent for *text* and flips light/dark for legibility on its
own ground. `--fill` is the solid accent *behind* text and stays saturated in
both themes — one token cannot do both jobs without putting white text on pale
lavender.

## Streaming

`app/src/sse.ts` assembles a turn from the event stream and is tested against
fragmentation a live connection only produces by luck — chunk boundaries at
every offset, and a tool call's arguments split into individually-invalid JSON
pieces. Two rules live there:

- A tool's arguments arrive as `input_json_delta` fragments and are parsed only
  at `content_block_stop`. A tool with no arguments sends nothing at all, not
  `{}`.
- Stopping mid-turn keeps **text only**. A `tool_use` block with no matching
  `tool_result` makes the *next* request fail, so half a tool call would poison
  the conversation rather than end it.

## Gotchas that have already cost time

- The gateway's CORS allow-list must include `anthropic-version`, or every
  request fails as the webview's generic "Load failed".
- `VYLO_DIRECT_API=0` on the gateway disables the direct transport, and native
  tool calling only exists there — the app then gets a 503.
- Model ids use hyphens (`claude-opus-4-8`); the dotted form 404s upstream.
- Killing a child process does not kill what it spawned. Drain its pipes on
  threads rather than joining, or a timed-out command holds the app open.
- `bundle_dmg.sh` runs BEFORE the updater tarball. When it fails — a stale
  `/Volumes/dmg.*` mount is the usual cause — the build stops with the `.app`
  rebuilt and the tarball left over from the *previous* version, so uploading
  publishes the old build under the new number and nothing looks wrong. Always
  check the version inside the served tarball, not just the manifest.
- ConPTY opens by asking the terminal where the cursor is (`ESC [ 6 n`) and
  runs nothing until something answers. xterm.js does that for us in the app;
  anything headless must reply itself or the shell never starts.
- ConPTY does not close the master when the child exits, so reader EOF never
  arrives on Windows. Terminal exit is signalled from `child.wait()`, and no
  test may read a pty to EOF — the first one that did wedged Windows CI for
  hours. Same lesson as the pipe draining above.
