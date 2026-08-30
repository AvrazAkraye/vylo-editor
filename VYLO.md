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

### Where exporting a chat sits inside that rule

`export_write` takes an absolute path and does not contain it, which reads like
a hole and is not one. It is absent from the tool schema, so no tool call
reaches it; its path comes from the OS save panel, so no string the model
produced chooses where it writes; and its content is a markdown transcript of a
conversation the person pressing the button has been reading. It is the same
shape as the editor's save and the terminal's keystrokes: the human is the
author, and what it produces is a record, not code that anything runs.

### Where the message queue sits inside that rule

A message typed into the composer while a turn runs is a human's own sentence
travelling the same path as any other user message: it becomes one `user` turn
and nothing else. It authorises no write, approves no command and skips no
dialog. The direction that would matter is the reverse, and it does not exist —
nothing the model produces can be put in the queue, and `queue.ts`'s `add` is
called from exactly one place, a keystroke in the textarea.

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

## The disk moves underneath this app

It ships its own terminal, so `git checkout`, `git pull` and `npm install` all
happen inside it. `src-tauri/src/watch.rs` watches the canonicalised root and
`src/watch.ts` decides what a batch means: a clean buffer is reloaded, a **dirty
one is asked about and never reloaded** — a reload is a full-document replace
and would destroy unsaved work with no undo entry — a staged proposal whose file
moved is re-based rather than dropped, and the app's own writes are muted for
1.5 s so saving a file does not send your own caret to the end of it.

`list_tree`, `search` and the symbol index now share one walk
(`src-tauri/src/walk.rs`) with one set of ignore rules: the project's own
`.gitignore` first, a floor of dependency and cache trees underneath it, and no
depth cap. Three walkers were three answers to "what is in this project", and
the agent could see all three disagree.

## Containment

Every path the model supplies is resolved with `canonicalize` against the open
folder and rejected if it escapes — `..` and symlinks resolve rather than being
pattern-matched. `read_image` is the one deliberate exception: a human dragging
a file in has chosen it explicitly.

## Commands

- `npm run build` — typecheck and bundle the frontend
- `npm test` — the pure logic: diffs, SSE assembly, ranking, context fitting,
  syntax spans, the navigation trail, retry policy, learned model limits, the
  message queue, the environment block, the parse check, the chat store and the
  filesystem-watch policy (1230)
- `cd src-tauri && cargo test` — 109, including the stale-write guard and the
  shared ignore-aware walk
- `npx tauri build` — produces the `.app` and `.dmg`

Release with `scripts/publish-macos.sh`, then `scripts/publish-windows.sh`
once CI has built the same commit — Windows binaries cannot be built on a Mac,
and the update server's credentials are deliberately not in CI, so CI builds
and signs while this machine publishes. Both go through `push-update.sh`, the
only thing that writes `latest.json`. Releases and the signing key are documented in
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

## Context

`app/src/budget.ts` fits the conversation into the model's window before every
request. It matters that the cut is only ever made at a **turn start** — a user
message that is a real question rather than a carrier for `tool_result` blocks.
Cutting anywhere else separates a `tool_use` from its result, and the next
request then fails for being malformed, which never recovers on its own; the
context error at least does. Order of loss: trim old tool results, then
summarise older turns into the system prompt, then keep fewer turns.

`max_tokens` comes from the same table. Unknown model ids get 4096 — the value
the app always sent — because a `max_tokens` above what a model accepts fails
the request outright, and guessing high on an unfamiliar id breaks the one case
where someone is doing something deliberate.

That table is only the opening guess. `app/src/limits.ts` learns a model's real
numbers from the 400s that name them — `prompt is too long: … > 200000 maximum`
and `max_tokens: … > 32000, which is the maximum allowed for this model` — keeps
them per model id in `vylo.limits.v1`, and `runAgent` sends the same request
again immediately with the corrected budget. The parsing is anchored on the
wording of each error and not on `a > b`, because a rate-limit message has the
same shape and learning a per-minute quota as a context window would be silent
and permanent. Values are bounded on the way in *and* on the way out of the
store: a learned context below 10,000 is refused, so a corrupted store cannot
brick every future request.

Reaching the twelve-hop cap no longer throws the turn away. `runAgent` raises
`HopLimit`, which carries the messages exactly as `Stopped` does, and the
transcript offers **Continue** — a human press every time, because a cap that
continues by itself is a pause with extra steps. Nothing is appended to the
conversation on resume: it already ends with a user message of `tool_result`
blocks, which is a complete request.

## What is kept outside the project, and why

Four stores live in the Tauri app data directory and never in the folder being
edited: drafts (unsaved buffers), checkpoints (the file contents before an
approved write, plus the conversation tail so a redo can put it back), local
file history (every version this app has written, so a human saving over their
own work can get it back), and clipboard history.

The last one carries a rule worth keeping in front of anyone who touches it:
**it does not poll the OS clipboard.** A history that polls records whatever a
password manager put there thirty seconds ago. It records only what is pasted
*into* this app, skips what the OS marks concealed, and has a visible clear.
`src/clips.ts` says so in its first paragraph; leave that paragraph there.

Everything in that directory is capped by count, by bytes and by age, and every
store has a way for a person to empty it.

## Where dictation and the screenshot sit inside the rule

Both are the human authoring their own input, like the terminal and the memory
editor. Dictation puts text in the composer for a person to read and send — it
is deliberately not "voice commands", because letting recognised speech *run*
something would be putting text into a shell that no human read. And
`capture.rs` takes an enum, never a string: the program is an absolute path and
every flag is a `&'static str`, so there is no argument for anything to reach.
The user drags the crosshair themselves, which is what makes the capture theirs.

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
