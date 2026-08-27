# ADR 0002 — The agent runs locally on the desktop

**Status:** accepted · 2026-08-19 · **supersedes [ADR 0001](0001-server-side-workspace.md)**

## Context
ADR 0001 put the repository, the tools and the agent loop on a server. Its whole
justification was iOS: an iPhone cannot open a user's folder, cannot invoke
`git`, and cannot execute code it downloaded, so nothing else was possible.

The target platforms are now **macOS and Windows only**. Neither has any of those
limits.

## Decision
The agent runs **locally, inside the desktop app**. Tauri's Rust process is the
tool layer: it reads and writes files, searches the tree and runs commands
directly on the user's machine. Only model inference leaves the device, to the
Vylo Claude gateway.

## Consequences

**Good — most of the risk and cost in ADR 0001 was iOS tax, and it is now gone:**
- No sandbox. Untrusted-code execution on our infrastructure was the largest
  engineering risk in the project (PRD R1) and it no longer exists.
- No custody of customer source. Their code never leaves their machine, which is
  a stronger privacy story than any policy we could have written.
- No workspace service, no per-user containers, no clone volumes, no GitHub App
  required — local `git` is right there.
- Instant file access instead of a network round-trip per read.
- Roughly 14 weeks of work becomes roughly 6.

**Bad — the wedge changes:**
- Desk-to-phone handoff is gone. It was the one thing Cursor structurally could
  not copy, and it went with iOS. Differentiation now rests on price, payment
  access in the region, Kurdish/Arabic UI, and running on infrastructure we own.
- No sync between a user's machines, and nothing continues while the app is
  closed. Both are recoverable later by adding an optional server, which is a
  strictly easier problem than starting there.

**The security question moves rather than disappears:** the agent now runs
commands on the user's own machine. That is exactly what Cursor and Claude Code
do, and the answer is the same — explicit human approval for writes and for
commands, which is a UX problem rather than an infrastructure one.
