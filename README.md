<p align="center">
  <img src="brand/preview-512.png" alt="Vylo Editor" width="112" height="112">
</p>

<h1 align="center">Vylo Editor</h1>

<p align="center">
  An AI coding agent and editor that works on a folder on your own machine,<br>
  running on your own Vylo Claude gateway.
</p>

<p align="center">
  <strong>0.118.0</strong> · macOS and Windows · 8 MB installed · Tauri v2 · Rust + React
</p>

---

## Download

| | |
|---|---|
| **macOS** (Apple Silicon) | [Vylo-Editor-macOS-AppleSilicon.dmg](https://github.com/AvrazAkraye/vylo-editor/releases/latest/download/Vylo-Editor-macOS-AppleSilicon.dmg) |
| **Windows** (x64) | [Vylo-Editor-Windows-x64-setup.exe](https://github.com/AvrazAkraye/vylo-editor/releases/latest/download/Vylo-Editor-Windows-x64-setup.exe) |

Those two links always fetch the newest release; the app updates itself after
that, so it is the last time you download it by hand. Every version, with its
notes, is on the [releases page](https://github.com/AvrazAkraye/vylo-editor/releases).
Intel Macs are not built yet.

**Both systems will warn you on first launch, and they are right to.** These
binaries are not code-signed, so the OS cannot tell you who built them — check
where you got the file from before overriding it, here as anywhere else. On
macOS, right-click the app and choose *Open*, then *Open* again; double-clicking
will not offer you the choice. On Windows, choose *More info*, then *Run anyway*.

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
Every request the app makes is listed in [SAFETY.md](SAFETY.md), with the file
that makes it: the gateway, a model provider or WhatsApp instance you add
yourself, and — for a Research document you start — two public catalogues of
scholarship, OpenAlex and Crossref.

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
if one ever appears. Two things can carry an approval forward, and both are
decisions a person makes: **Always allow this**, which remembers one command
string, matched exactly, in memory, until you open a different folder; and
**auto-approve** (Settings → Approval), which answers the dialog for a class of
action you chose in advance. Auto-approve is off every time the app starts,
nothing but a person can turn it on, a refuse-list — `rm -rf`, `git push`,
`sudo`, `curl … | sh` and the rest — always asks at every level, and every
write it applies is checkpointed so it can be undone. It answers the gate; it
does not remove it, and the model gains no tool either way. A repository that
contains *"ignore previous instructions and…"* gets you a dialog, not a write.
See [SAFETY.md](SAFETY.md).

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

**Research, written the way Iraqi and Kurdish universities ask for it.** Turn
on the Research module and say what you need — *ورقة عمل عن…*, *رسالة ماجستير
في…*, *نامەی ماستەر لەسەر…*, *a PhD dissertation on…* — and the phrase switches
on that kind of document: a working paper, a research article, a conference
paper, a literature review, a research proposal, a graduation project, a
master's thesis or a PhD dissertation, in Arabic, Sorani, Badini or English,
each with the structure it is examined against (المقدمة، المباحث والمطالب،
الخاتمة). You choose the model and how hard it thinks, the number of words and
of sources, and how many writers work on the parts at once; attach your own
Excel, Word, CSV or PDF results and the document reports them as they are. It
is planned, outlined and written section by section — in the sidebar or over
the whole window — and saved as a Word file or a
PDF, with the cover page and the university's logo and name, footnotes that
say *مصدر سابق* the second time, Arabic-Indic numerals and a قائمة المصادر
grouped by kind. The references are real: found in OpenAlex and Crossref, or
added by DOI, and the model may cite only those, through markers the app turns
into citations itself — it is never asked to write one. Where the document
needs the researcher's own data, it leaves a marked gap instead of inventing
any.

**Video, made with AI and drawn by the app.** Turn on the Video module and
describe the video — *a 30-second vertical promo for UoD, in Arabic*. The app
first looks the subject up on the web — Wikidata, Wikipedia and Wikimedia
Commons — so "UoD" becomes the University of Duhok with its real founding year,
website and photographs, each fact shown with its source for you to keep or
drop. The model then writes a storyboard from those facts: sixteen kinds of
scene, among them a title, kinetic words, a counting number, a chart, a
timeline, a comparison, people, a photo montage, a logo reveal and a QR code.
The app's own Remotion templates draw it in six styles, in Arabic, Kurdish or
English, landscape, vertical or square, with openly licensed pictures, music
composed for it in the app — eight moods, among them an oriental one on the
maqamat with darbuka and oud — or found openly licensed, an optional narrated
voice and captions. Then **chat with the video** — "make it shorter", "translate
it to Sorani", "compose calmer music" — and it changes, one undoable step a
message. Edit it on a timeline with undo, start from one of ten templates, take
the brand colours from your logo, and **Download MP4** — or WebM, 4K, all three shapes at once, a
poster, subtitles — rendered in the app itself. The model never writes code; it
writes the storyboard.

**Slides, from a sentence or a Research document.** Turn on the Slides module
and describe the presentation — or pick a paper, thesis or defence the Research
module wrote — and get slides in Arabic, Kurdish or English that you edit,
present full screen, and save as a PowerPoint file or a 16:9 PDF. Like Video,
the model writes the words and the app draws them.

**Native, and small.** 8 MB installed and a 4 MB download, because it is a
Tauri app with a Rust tool layer rather than an Electron shell. One codebase
produces both the macOS `.app` and the Windows `.exe`.

## What it will not do

- **Act on its own uninvited.** A routine runs a named agent on a schedule, so
  the app does work you did not just ask for — but only a routine you wrote,
  only while the app is open, only in the folder it was made in, and reads-only
  unless you turned auto-approve on. Nothing runs when the app is closed: a
  slot missed while it was shut is reported and skipped, never run late. There
  is no cloud agent and no account of ours running anything.
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

- **Windows is built but not lived in.** Both platforms are published at the
  same version, and the full suite — frontend and Rust — runs on a Windows
  runner in CI before each release. But nobody has sat and worked in it on a
  Windows machine. A green build is not the same as an hour of real use, and
  the difference is where the remaining bugs will be.
- **Nothing is code-signed.** macOS needs right-click → *Open* the first time,
  Windows needs *More info → Run anyway* past SmartScreen. Update artifacts are
  signed — with a minisign key whose public half is compiled into the app — but
  that is a different signature from the one the OS looks for at install.
- **Only Apple Silicon is published.** The update manifest has a
  `darwin-aarch64` entry and nothing else; there is no Intel macOS build being
  served.
- **It is not on sale.** The gateway enforces plans and meters usage, but the
  commercial switchover is not done and nobody is being charged for anything
  yet.

## Building it

Node 20 and a stable Rust toolchain. A gateway key (`sk-vylo-…`) goes into
Settings inside the app.

```bash
cd app
npm install
npm run dev                    # Vite; or npx tauri dev for the shell
npm run build                  # typecheck and bundle
npm test                       # frontend suite (4,282 tests)
cd src-tauri && cargo test     # tool layer (129 tests)
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
- **[docs/decisions/](docs/decisions)** — the architecture decisions that were
  taken once and are expensive to revisit, with the reasoning kept.

The product and roadmap documents are not in this repository. They are working
notes about customers, pricing and what is not finished yet, and they are kept
where notes like that belong.

## Licence

Source-available under the [PolyForm Noncommercial 1.0.0](LICENSE.md) licence,
which is a standard, lawyer-drafted licence rather than one written here.

| | |
|---|---|
| Personal use | ✅ |
| Study, research and teaching | ✅ |
| Read the source, change it, build your own copy | ✅ |
| Share your changes, on the same terms | ✅ |
| Use it commercially, including inside a company | ❌ |
| Sell it, or sell anything built on it | ❌ |

In one line: do anything you like with it that is not a commercial purpose. The
licence spells out what counts — personal projects, study, hobby work, and use
by schools, universities, charities, public research and government are all
permitted, whoever funds them.

If you want it for commercial use, that is a conversation rather than a refusal:
open an issue. Nothing here restricts Vylo Tech, which holds the copyright.

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
