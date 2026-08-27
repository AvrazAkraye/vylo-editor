# ADR 0001 — The workspace lives on the server

**Status:** superseded by [ADR 0002](0002-desktop-local-agent.md) · 2026-08-19

> Superseded the same day: iOS was dropped from the targets, and iOS was this
> decision's entire justification. Kept for the reasoning, not as guidance.

## Context
Vylo Editor targets iOS and Windows. On iOS an app cannot open arbitrary user
folders, cannot invoke `git` or a package manager, and cannot execute code it
downloaded — App Store review rejects that shape outright.

## Decision
The repository clone, the tool execution and the agent loop all run server-side.
Every client — Windows, iOS, web — is a thin window onto a server session.

## Consequences
**Good.** iOS becomes possible at all. Sessions survive a client disconnecting,
which is what makes desk-to-phone handoff work — the feature a local-only editor
such as Cursor structurally cannot offer.

**Bad.** We now execute model-generated commands against customers' private
source code on our infrastructure. Sandboxing (PRD §9) becomes the single
largest engineering risk in the project, and we take on custody obligations for
customer code. Nothing works offline.

**Rejected:** a local agent on desktop with a companion phone app. It would ship
sooner on Windows but leaves iOS as a chat toy, discarding the wedge.
