<p align="center">
  <img src="brand/preview-512.png" alt="Vylo Editor" width="112" height="112">
</p>

<h1 align="center">Vylo Editor</h1>

<p align="center">
  An AI coding agent and editor that works on a folder on your own machine,<br>
  running on your own Vylo Claude gateway.
</p>

<p align="center">
  <strong>0.23.0</strong> · macOS and Windows · 8 MB installed · Tauri v2 · Rust + React
</p>

---

## What it is

Open a folder. Ask a question and the agent answers it citing `path:line`.
Describe a change and it stages a diff you accept hunk by hunk. Ask it to run
the tests and it shows you the exact command and waits.

Around that loop is a real editor rather than a chat window: CodeMirror 6 with
syntax highlighting and ⌘S, ⌘K inline edit on a selection, ⌘P and ⌘⇧F,
go-to-definition, `@file` / `@folder` / `@terminal` mentions, checkpoints that
rewind the files *and* the conversation to an earlier turn, a local index
(BM25 over identifiers plus a symbol table), an MCP client, a real pty
terminal, git branch and commit, inline completion, and four interface
languages.

Model calls go to the Vylo gateway at `capi.vylo-tech.com`, never to Anthropic
directly. What leaves the machine is your prompt, the file content the agent
chose to read, and — with inline completion on — the code either side of your
cursor. Nothing else: there is no backend of ours, no telemetry and no sync.
Every network call the app makes goes to the gateway, and the webview's
`connect-src` allows no remote host but `vylo-tech.com`.

## What makes it different

**The approval gate is a missing capability, not a setting.** The model is given
exactly eight tools — `list_tree`, `read_file`, `find_symbol`, `search`,
`write_file`, `edit_file`, `run_command`, `remember`. The first four read. The
rest do not act: `write_file`, `edit_file` and `remember` stage a result for you
to read, and `run_command` suspends the loop until a human has approved the
exact string. The Rust commands that actually do anything — write a file
(`apply_write`), create, rename or delete one, branch or commit, start an MCP
server, drive the terminal (`pty_*`), take a screenshot — are **absent from that
schema**, so no amount of prompting reaches them. They are callable only from a
button a person pressed, and `test/modes.test.mjs` names each of them and fails
if one ever appears. There is no blanket auto-approve to switch on: the one
thing that carries an approval forward is **Always allow this**, which remembers
that one command string, matched exactly, in memory, until you open a different
folder. A repository that contains *"ignore previous instructions and…"* gets
you a dialog, not a write. See [SAFETY.md](SAFETY.md).

**It runs on a gateway we own.** Cursor is $20/month on an international card,
and for customers in Iraq and Kurdistan that card is more often the blocker than
the amount. Model capacity here is metered by our own gateway — per-key auth,
plan enforcement and usage accounting, in production today — so it can be sold
in a local currency, through a payment route the American subscription products
do not reach. A product where the buyer brings their own key cannot do that.

**Kurdish is in the product.** Central Kurdish (Sorani) and Badini alongside
English and Arabic, translated in full rather than bolted on: one test fails
when a key is missing from a catalogue, and a second fails when a `t('…')`
string in the UI has no catalogue entry at all. Layout stays left-to-right in
every language — a deliberate decision, matching the Vylo OTP dashboard — while
Arabic-script text shapes right-to-left within each line.

**Native, and small.** 8 MB installed and a 3.9 MB download, because it is a
Tauri app with a Rust tool layer rather than an Electron shell. One codebase
produces both the macOS `.app` and the Windows `.exe`.

## What it will not do

- **Act on its own.** No autonomous mode, no background or cloud agents. Each
  would mean model output reaching a shell with nobody having read it.
- **Replace your IDE.** Not a VS Code fork; no language servers, no debugger, no
  extension marketplace. The editor exists so you can read and correct what the
  agent is talking about.
- **Run on a phone, sync, or hold an account of ours.** The app talks to your
  disk and to the gateway, and to nothing else.
- **Open more than one folder at a time.**
- **Use embeddings.** Vector search would mean a second vendor and your source
  leaving the machine for a company you did not buy anything from. `find_symbol`
  plus BM25 ranking does the job locally and offline.
- **Ship a list of MCP servers.** A curated marketplace would be us vouching for
  third-party commands we otherwise tell you to read for yourself. `.vylo/mcp.json`
  travels with the repository, so nothing starts until you have read the exact
  command and enabled it.

## What is not finished

- **Windows lags.** macOS is built, gated and published from the maintainer's
  own Mac; Windows binaries can only be produced in CI, because Tauri needs the
  target's own toolchain. This release has not been built there, and the update
  manifest carries a macOS entry only — so a Windows install is offered no
  update at all rather than a mismatched one.
- **Nothing is code-signed.** macOS needs right-click → *Open* the first time,
  Windows needs *More info → Run anyway* past SmartScreen. Update artifacts are
  signed — with a minisign key whose public half is compiled into the app — but
  that is a different signature from the one the OS looks for at install.
- **Only Apple Silicon is published.** The update manifest has a
  `darwin-aarch64` entry and nothing else; there is no Intel macOS build being
  served.
- **It is not on sale.** The gateway enforces plans and meters usage, but the
  commercial switchover is not done and nobody is being charged for anything
  yet. See §10 of the PRD.

## Building it

Node 20 and a stable Rust toolchain. A gateway key (`sk-vylo-…`) goes into
Settings inside the app.

```bash
cd app
npm install
npm run dev                    # Vite; or npx tauri dev for the shell
npm run build                  # typecheck and bundle
npm test                       # frontend suite (1,397 tests)
cd src-tauri && cargo test     # tool layer (109 tests)
npx tauri build                # .app and .dmg
```

Those three gates are one command from the repo root, cheapest first, stopping
at the first failure:

    scripts/gate.sh            # all three, about ten seconds warm
    scripts/gate.sh frontend   # npm test and npm run build, about five

Git hooks that run it live in `.githooks/`. They are **opt-in** — a clone
installs nothing until you ask:

    git config core.hooksPath .githooks

Releases go out through `scripts/publish-macos.sh` and, once CI has built the
same commit, `scripts/publish-windows.sh`. Both write the update manifest
through `scripts/push-update.sh`, which is the only thing that does.

## Read next

- **[docs/PRD.md](docs/PRD.md)** — what the product is: goals and non-goals,
  architecture, the security model, pricing, risks.
- **[docs/PRD-IMPROVEMENT.md](docs/PRD-IMPROVEMENT.md)** — what to fix next and
  in what order, written against the code and a competing product.
- **[SAFETY.md](SAFETY.md)** — the approval gate in detail, what it does not
  cover, and how to report a way around it. Also in
  [العربية](SAFETY.ar.md), [کوردیی ناوەندی](SAFETY.ckb.md) and
  [کوردیا بادینی](SAFETY.kmr.md).
- **[docs/CONTRIBUTING.md](docs/CONTRIBUTING.md)** — the three gates, the hooks,
  the one-writer-per-file convention, and the two rules that bite: i18n and the
  tool schema.
- **[docs/RELEASING.md](docs/RELEASING.md)** — the signing key, and why CI
  builds while one Mac publishes.
- **[VYLO.md](VYLO.md)** — the notes the agent carries into every session in
  this project.

## Brand

`brand/` holds the Vylo Editor mark: the **V** of Vylo drawn as a code chevron,
with a text caret beside it. Rendered app icons are in `brand/icons/`.

> The only logo files on the Vylo server belong to **IQ ERP**, not Vylo, so this
> mark was drawn for this product in the same family style. Swap it if a real
> Vylo Tech corporate mark exists.

## Licence

Private and unpublished. All rights reserved.

That covers Vylo's own code. The third-party code inside the binary is a
separate obligation: MIT, BSD and Apache-2.0 each require their copyright
notice and licence text to travel with a distribution, and
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) is how they travel.

That file is generated, never hand-written — `scripts/notices.sh` rebuilds it
from `npm ls` and `cargo metadata`, and `scripts/notices.sh --check` exits
non-zero when it is stale, which makes it usable as a CI step or a commit hook.
