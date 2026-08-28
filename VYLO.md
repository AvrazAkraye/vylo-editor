# Project memory

Notes Vylo Editor carries into every chat in this project.

## What this is

A Tauri v2 desktop app (macOS + Windows) that runs a coding agent against a
folder on the user's own machine. The Rust side is the tool layer; the React
side is the UI and the agent loop. Model calls go to the Vylo gateway at
`capi.vylo-tech.com`, never to Anthropic directly.

## The rule the whole design rests on

**The model has no tool that writes or executes.** `write_file`, `edit_file` and
`remember` stage a result for human review; `run_command` suspends the loop
until a human approves the exact string. The Rust commands that actually touch
the disk (`apply_write`) or run a shell (`run_command`) are **absent from the
tool schema**, so they cannot be reached by a tool call however the model is
prompted.

Keep it that way. If you add a capability, add it as a staged proposal, not as a
direct action.

## Containment

Every path the model supplies is resolved with `canonicalize` against the open
folder and rejected if it escapes — `..` and symlinks resolve rather than being
pattern-matched. `read_image` is the one deliberate exception: a human dragging
a file in has chosen it explicitly.

## Commands

- `npm run build` — typecheck and bundle the frontend
- `npm test` — the diff tests (11)
- `cd src-tauri && cargo test` — containment, command timeout, output truncation,
  commit scope (4)
- `npx tauri build` — produces the `.app` and `.dmg`

Releases and the signing key are documented in `docs/RELEASING.md`. Windows
binaries cannot be built on a Mac; they come from CI.

## Gotchas that have already cost time

- The gateway's CORS allow-list must include `anthropic-version`, or every
  request fails as the webview's generic "Load failed".
- `VYLO_DIRECT_API=0` on the gateway disables the direct transport, and native
  tool calling only exists there — the app then gets a 503.
- Model ids use hyphens (`claude-opus-4-8`); the dotted form 404s upstream.
- Killing a child process does not kill what it spawned. Drain its pipes on
  threads rather than joining, or a timed-out command holds the app open.
