<p align="center">
  <img src="brand/preview-512.png" alt="Vylo Editor" width="112" height="112">
</p>

<h1 align="center">Vylo Editor</h1>

<p align="center">
  An AI coding agent you drive from a Windows desktop app <em>and</em> your iPhone,<br>
  running on your own Vylo Claude gateway.
</p>

---

## Status

**Planning.** No application code yet — this repository currently holds the
product definition and the brand assets. Start with
**[docs/PRD.md](docs/PRD.md)**, then **[docs/ROADMAP.md](docs/ROADMAP.md)**.

## The idea in one paragraph

An iPhone cannot run Cursor — it cannot open your folders, shell out to `git`, or
execute code it downloaded. So the repository, the tools and the agent loop all
live on a server, and every client is a window onto it. That turns the iOS
constraint into the product: start a task at your desk, walk away, and approve
the diff from your phone while the agent keeps working. A local-only editor
structurally cannot do that.

## Shape

```
Windows .exe ┐
iOS app      ├─ Tauri v2 shells over one React UI
Web          ┘
      │  HTTPS + WebSocket
      ▼
Vylo Editor API ──► workspace sandbox (repo clone, tools, one container per user)
      │
      └─────────► chat.vylo-tech.com  ──►  api.anthropic.com
```

## Before any of this can start

Two fixes in the existing gateway, both small, both blocking — see §10 of the
PRD:

1. **Native tool calling.** Tools are currently emulated through the system
   prompt and parsed back out of the reply text. An agent loop needs real
   `tool_use` blocks. (~1 day)
2. **Move to a metered API key.** The gateway needs a metered credential of
   its own before anyone else's requests go through it. (~1 hour)

## Brand

`brand/` holds the Vylo Editor mark: the **V** of Vylo drawn as a code chevron,
with a text caret beside it. Rendered app icons are in `brand/icons/`.

> The only logo files on the Vylo server belong to **IQ ERP**, not Vylo, so this
> mark was drawn for this product in the same family style. Swap it if a real
> Vylo Tech corporate mark exists.

## Licence

Private and unpublished. All rights reserved.
