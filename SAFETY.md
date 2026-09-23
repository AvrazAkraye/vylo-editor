# Safety

**English** · [العربية](SAFETY.ar.md) · [کوردیی ناوەندی](SAFETY.ckb.md) · [کوردیا بادینی](SAFETY.kmr.md)

What Vylo Editor can and cannot do to your machine.

Vylo Editor runs a coding agent against a folder you choose, on your own
computer. The whole design rests on one rule:

> **No model output reaches disk or a shell without a human having approved
> it — that exact content and string by default, or, when auto-approve is
> turned on, a class of action decided in advance for that session.**

That sentence used to be shorter: it said *read and approved that exact
content*, with no exception. Version 0.52.1 added a mode where the app can
answer for you, and the sentence was changed rather than the mode being hidden
behind it. What has not changed is who decides: auto-approve is off every time
the app starts, and nothing but a person can turn it on.

This document says what that means in practice, where it is enforced, and — the
part that earns the rest of it — what it does *not* cover. Every claim names the
file that makes it true, so you can check it rather than trust it. It describes
version 0.101.0.

---

## Approving in advance

**Off every time the app starts.** Not remembered, deliberately: the person who
turned it on knew why, and a week later the same window opening with the gate
already down is not the same decision. Settings → Approval, three choices:

| | what it does |
|---|---|
| **Ask me every time** | The default, and what the app has always done. |
| **Apply edits, ask before commands** | Staged file changes land on their own. Every command still asks. |
| **Apply edits and run commands** | Commands run too, except the ones below. |

While it is on, an amber marker sits in the status bar for as long as it lasts,
and pressing it goes straight back to this setting. Everything it approves is
written into the transcript, marked as such, so what happened while you were
not reading is something you can read afterwards.

**The model gains nothing.** `apply_write`, the Rust `run_command` and every
`pty_*` command stay absent from the tool schema, exactly as before
(`app/test/modes.test.mjs`). Auto-approve answers the dialog; it does not go
round it. Every write still passes through `Pending` and every command through
`askToRun`, which is why the next point is true:

**Every auto-applied write is still checkpointed.** The previous contents are
kept before the new ones land, so an unattended change is an undoable one
(`app/src-tauri/src/checkpoint.rs`). This mode is defensible because it is
*reversible*, not because it is supervised.

### What is never auto-approved

Some commands are not undoable and no checkpoint helps. These always ask, at
every level, and **there is no setting that turns this off**
(`app/src/auto.ts`, `app/test/auto.test.mjs`):

- anything that deletes — `rm -rf`, `rmdir`, `shred`, `find … -delete`,
  `git clean`
- anything that writes to a disk or device directly — `dd`, `mkfs`, `> /dev/…`
- anything that leaves this machine or rewrites shared history — `git push`,
  `git rebase`, `git reset --hard`, `npm publish`
- anything that runs as somebody else, or runs something downloaded —
  `sudo`, `curl … | sh`
- anything that affects the whole machine — `shutdown`, `systemctl`, `killall`
- anything that says something to another person — a WhatsApp message the
  agent proposed (`whatsapp_send`). It is the one entry here that is not a
  shell command, and it is here for the same reason as the rest: no
  checkpoint holds it, and the person who reads it is not in the room

The list matches on text, so it will sometimes stop a command that was
harmless. That is the direction to be wrong in, and the cost of being wrong is
one dialog.

**Always allow this cannot reach that list.** The refusal is worked out before
anything is allowed to answer on your behalf, and the button is not offered at
all for a command the list caught (`askToRun` in `app/src/App.tsx`). Allowing
`git push` once does not stop it asking the next time, and nothing does.

**At the third level an MCP tool call runs too.** Every rule above is written
against a shell command, and the string `runTool` builds for a tool call —
`server: tool({"the":"arguments"})`, in `app/src/agent.ts` — matches none of
them. So during your own turn, at that level, an enabled server's tool runs
without asking, exactly as any other command does. A routine's turn is the
exception, and the next section says so.

---

### Routines

A routine is an agent, a brief and a time, and it runs while the app is open
whether or not you are at the keyboard (`app/src/routines.ts`,
`app/src/agents.ts`). That is the one place the app acts without a person
having just typed something, so it gets the strictest reading of the rule:

- An unattended run is **Ask mode** — reads only — whatever mode the agent was
  given, unless auto-approve is on (`modeFor` in `app/src/agents.ts`,
  `app/test/agents.test.mjs`). Auto-approve was a decision made in advance for
  this session; a routine runs under that decision and no wider one.
- The refuse-list above applies to a routine exactly as it does to you. So does
  the other half of that promise: a routine never spends an Always allow this
  you granted at a dialog you were sitting in front of, because that was a
  person answering a question and this is not (`askToRun`).
- **An unattended run never uses an MCP tool without asking**, at any level —
  which, with nobody at the dialog, means it does not use one at all. The
  refuse-list is written against shell commands and describes none of these
  calls, and a third-party tool's side effects are not visible from its name.
- **A routine belongs to the folder it was made in.** It names its agent by a
  heading in that project's `.vylo/AGENTS.md`, and the starter file gives every
  project the same headings — so the list is filtered by `folder` before the
  scheduler or either panel sees it (`inFolder` in `app/src/routines.ts`). A
  routine made in one project never runs in another. Routines made before
  0.55.0 carry no folder, and used to belong to whichever project was open —
  the very thing this closes. The first project opened after this version
  adopts them, a line in the transcript says how many, and one that belongs
  elsewhere is moved by editing it there (`adopt` in `app/src/routines.ts`).
- **Run now is attended.** You are at the approval dialog by definition, so a
  run you start by hand uses the agent's own mode; only the scheduler's runs
  are held to reads-only.
- Every run is a chat of its own, so what a routine did is a transcript you can
  open afterwards, and every write it made is checkpointed. Its first line names
  the routine, the agent and the mode the run was given, so a transcript read a
  week later still says what that agent was allowed to do at the time, even if
  `.vylo/AGENTS.md` has been edited since.
- **While a run is in flight the window is its own.** Opening another folder,
  starting a new chat or opening an old one is refused until it ends — otherwise
  the run streams into that chat and is saved there instead of under its own.
  Stop ends it immediately.
- Runs missed while the app was closed are reported and skipped, never run
  late (`missedWhileClosed` in `app/src/routines.ts`): a week of Monday
  reports is not something to catch up on on a Friday. That report deliberately
  covers every project's routines and not only the open one's — a run that was
  skipped was skipped wherever it belongs — and each routine from another
  project is named with that project's folder, so a name out of a checkout you
  cannot see is still one you can place. The dashboard notice has no room for
  that label and is given the open project's share. The report goes into the
  transcript as well as onto the dashboard, which is a module you can switch off.
- **Opening a project settles what that project is already owed.** The tick is
  one clock for the whole app, so a slot that passed while a different project
  was on screen sits behind the launch window: it would be reported by nothing,
  and the routine would fire the moment its own project was opened, days late.
  Opening a folder therefore asks the same question about that folder alone and
  answers it the same way — reported, and skipped (`owedNow` in
  `app/src/routines.ts`).

## What reaches the network

Vylo Editor talks to your Vylo gateway, and — only if you add them — to model
providers you configure yourself. Out of the box it is one service: the model
API and the account API are both the gateway. There is no third-party identity
provider, no analytics, no crash reporting, and nothing is contacted that you
did not name.

**Added providers** (Settings → Account → Model providers) each have their own
address and their own key, and one rule governs them, pinned by
`app/test/providers.test.mjs`: **a key is only ever sent to the address it was
entered beside.** Key and address live in one record and every request derives
both from that record — there is no code path that pairs one provider's key
with another's URL, and removing a provider removes its key with it. Nothing is
ever fetched from a provider on startup or when Settings opens; the first
request to a provider is the first message you send to one of its models.

Because addresses are yours to choose, the content-security allow-list below
now permits `https:` generally (plus plain `http` to `localhost`, for Ollama
and LM Studio). That is a real widening, and it moves the enforcement: what
used to be proven by the CSP alone is now proven by `app/src/providers.ts` —
which refuses non-https addresses, normalises them, and routes every request —
and by the tests on it. The app still makes no request anywhere except the
gateway and the providers in your list.

The frontend makes eight kinds of outbound request. Seven go to the gateway:

| Where | Request | When |
|---|---|---|
| `app/src/agent.ts` | `POST {gateway}/v1/messages` | every agent turn |
| `app/src/inline.ts` | `POST {gateway}/v1/messages` | ⌘K rewrite, apply-from-chat |
| `app/src/complete.ts` | `POST {gateway}/v1/complete` | inline (ghost-text) completion |
| `app/src/gateway.ts` | `POST {gateway}/v1/messages` | checking a key you just pasted |
| `app/src/account.ts` | `POST {gateway}/app/api/auth/login` | signing in — `/auth/register` and `/auth/logout` are the same shape |
| `app/src/account.ts` | `GET {gateway}/app/api/me` | the plan balance: on launch, when a turn ends, otherwise every five minutes |
| `app/src/account.ts` | `POST {gateway}/app/api/keys` | minting this app's own key, once, at the end of a sign-in |

`{gateway}` defaults to `https://capi.vylo-tech.com` and can be changed in
Settings (`app/src/App.tsx`).

**The eighth is WhatsApp, and it goes where you send it.** Every request is
built in one place, `app/src/whatsappwire.ts`, from an Evolution API instance
whose address and key you enter together in `app/src/WhatsAppPanel.tsx`. No
request to your messages goes anywhere else (transcription is the one exception
and has its own paragraph below). One file is the whole network surface of the feature, which
is what lets the rule below be checked by reading rather than by trusting. It calls
`/instance/connectionState` to check what you entered,
`/chat/findMessages` on a timer while the panel is open,
`/chat/getBase64FromMediaMessage` when a photo, voice note or file is opened or
handed over, `/message/sendText` when a message is sent, and `/message/sendMedia`
or `/message/sendWhatsAppAudio` when you attach a file to one — each under the
instance name. A file you attach is read from disk by `read_any_file`, which is
reached only from the file dialog you opened: the dialog is the approval, and
nothing chooses a path on your behalf.
The rule is the one `app/src/providers.ts` states — the key is sent only to the
address it was entered beside, and every request is built from that address.

Messages are fetched to this machine and drawn there. **The agent can read
them, and only through tools you switched on by connecting an instance.**
`whatsapp_chats` and `whatsapp_read` in `app/src/whatsapptool.ts` are offered
to the model only once a connection exists, and they change nothing and leave
nothing behind, so they run like reading a file does. *Send to chat* still does
what it always did, for when you want to hand over one conversation rather than
let it look.

**A voice note can be transcribed, and only where you send it.** Nothing in
this app can hear audio: the model API takes none, and `dictate.ts` is the
browser's speech engine listening to a microphone, which cannot be pointed at a
file. The words come from a service you name, and `app/src/whatsappvoice.ts`
speaks to two kinds.

The first is **Vylo Voice** — `voice.vylo-tech.com` by default, or your own
address — which you authorise with its own `vsk_` key. It is the one with
engines for Badini and Sorani as well as Arabic and English, and it is tried
first because these conversations are in Kurdish. It queues a recording and
hands back a job, so the panel uploads once and then polls `/api/jobs/{id}`
until the words are ready or it gives up. The second is any OpenAI-shaped
provider already in Settings, which answers `/v1/audio/transcriptions` in one
round trip and was never trained on Kurdish. Either way the key and the address
come out of one record, under the rule everything else here follows: **a key is
only ever sent to the URL it was entered beside.**

This is the one place a WhatsApp message leaves your machine for somewhere other
than your own instance, so it is worth being exact about when. It is never
automatic. It does not happen on a timer, when the panel opens, when you scroll
past a voice note, or as part of *Send to chat* — it happens when you press
Transcribe on one particular message, and the button names the service it is
about to send that recording to. With nothing configured the button offers to
take you to Settings instead and uploads nothing. An untranscribed voice note
still travels to the model as a line saying it was not heard.

Which language it is in is your choice and is sent with the audio, because a
detector guesses badly on eight seconds from a phone. Kurdish is offered on
Vylo Voice, which has engines for it; on the OpenAI-shaped path a Kurdish
choice is dropped rather than sent, since that model would refuse it or answer
with something that only looks like an answer.

Vylo Voice can also translate what it heard, into English, Arabic or either
Kurdish, in the same pass and on the same server — no second service and no
further upload. Both come back and both are kept: the transcript is what was
said and the translation is a second reading of it, so they are shown as two
steps and handed to the model as two lines. Replacing one with the other would
hide a guess inside a guess.

**A reply you type is sent without a dialog. One the agent wrote is not.** You
are the author of your own sentence, and asking you to approve it is theatre,
for the reason the terminal has no approval step. `whatsapp_send` is the
opposite case: the words are the model's and they arrive under your name. It is
in the always-ask list above, it is asked at every auto-approve level and in
every routine, and the dialog shows the recipient and the exact text before
anything leaves this machine.

**The allow-list is what makes that a fact rather than an intention.** The
content security policy in `app/src-tauri/tauri.conf.json` is:

```
default-src 'self';
style-src   'self' 'unsafe-inline';
img-src     'self' data: blob:;
media-src   'self' blob:;
connect-src 'self' ipc: http://ipc.localhost
            https: http://localhost:* http://127.0.0.1:*;
frame-src   http://localhost:* http://127.0.0.1:*
            http://[::1]:* http://*.localhost:*
            https://localhost:* https://127.0.0.1:*
            https://[::1]:* https://*.localhost:*
```

`blob:` is on `img-src` and `media-src` so the window can show bytes it already
holds — a WhatsApp photo, a voice note — and it is worth being clear that this
grants no reach: a blob URL is an object the page made out of data already in
its own memory, and nothing new can be fetched through one. Their absence was a
bug rather than a policy. Every photo and every voice note was being blocked
after a successful download, which the panel could only report as a file that
would not open.

The window can reach https hosts generally — the price of letting you name your
own providers, since a policy cannot be edited at runtime. Which hosts are
*actually* contacted is decided by `app/src/providers.ts`: the gateway, each
provider you added, and the WhatsApp instance if you connected one — each with
only its own key. `chat.vylo-tech.com`
appears as text in three error messages (two in `app/src/errors.ts`, one in
`app/src/gateway.ts`), but nothing in the app fetches it.

**One connection comes from the Rust side.** Auto-update fetches
`https://capi.vylo-tech.com/updates/{target}/{arch}/{current_version}`, the
endpoint declared in `tauri.conf.json`. Update artifacts are signed with a
minisign key, and the public half is compiled into the app (`pubkey`, same
file); a tampered payload fails verification and is discarded before it runs
(`app/src/updates.ts`).

The private half exists in two places, both listed in `docs/RELEASING.md`: on
the maintainer's machine, and as a GitHub Actions secret
(`TAURI_SIGNING_PRIVATE_KEY`) that the Windows build job reads
(`.github/workflows/build.yml`). GitHub secrets are write-only, so CI can sign
with it and nobody can read it back. What matters for you is where it is
**not**: it is deliberately absent from the update server, so an attacker who
takes the distribution channel does not thereby gain the ability to sign what
travels down it.

**And nothing else.** No `.rs` file in this app opens a socket or makes a
request, and `app/src-tauri/Cargo.toml` declares no HTTP client of its own — the
only crate in it that speaks HTTP is `tauri-plugin-updater`, whose one endpoint
is the URL above. `app/src-tauri/capabilities/default.json`
grants the window fourteen permissions, and neither the HTTP plugin nor the
shell plugin is among them. There is no telemetry, analytics or crash-reporting
code anywhere in `app/src` or `app/src-tauri/src`.

### What is actually in a request

An agent turn carries the system prompt, an environment block, this project's
`VYLO.md` memory if it has one, the conversation so far, the contents of files
the agent read with `read_file`, search results, the output of commands you
approved, terminal output you pressed **Send to chat** on, and attachments you
added yourself.

The environment block (`app/src/environment.ts`) is deliberately thin: the OS,
the shell `run_command` would spawn, the open folder's **name** — not its
absolute path — the filenames of manifests present, the package manager implied
by the lockfile beside them, and script or target *names* filtered through an
allow-list. Prose fields such as `description` or `author` are never read.

⌘K sends the selection, your instruction, and sixty lines either side of it
(`CONTEXT_LINES` in `app/src/inline.ts`), plus project memory.

**Inline completion sends the whole file**, split at your cursor: `prefix`,
`suffix`, `path`, `language` (`app/src/complete.ts`). The truncation you may
notice in that file is in the *cache key*, not in the request body. It is on by
default, fires when you pause typing, and is switched off in Settings (stored as
`vylo.autocomplete`).

Your project is not uploaded. What leaves is what the agent read, and it read
that because it asked for it while you were watching.

### Dictation is the one thing that is not ours

The microphone uses the webview's own speech recognition —
`webkitSpeechRecognition`, in `app/src/dictate.ts`. Vylo sends no audio
anywhere: the recogniser belongs to the operating system, and whether it
transcribes on the device or on the vendor's servers is macOS's or Windows's
decision, not ours. That path is not covered by the policy above, because it is
not a request the page makes. Only final results are inserted into the composer,
and nothing recognised can *run* anything — dictation's only exit is a textarea.

### Your two credentials, and your password

**The gateway key** is kept in the webview's `localStorage` as `vylo.apiKey`,
in plaintext, not in the OS keychain. It is sent as the `x-api-key` header to
the four `/v1/` endpoints above and nowhere else. You can paste one, or sign in
and let the app mint its own: `POST {gateway}/app/api/keys` returns a key
exactly once and the server keeps only its hash, so what comes back is stored at
the moment it arrives or it is gone.

**The session token** is a JWT, kept the same way under `vylo.token`
(`app/src/account.ts`), and sent as an `Authorization` header to the three
`/app/api` endpoints above and nowhere else. It authenticates the *account*;
the key authenticates the *model*. The two are never interchanged, which
`app/test/account.test.mjs` asserts about the wire rather than about the prose.
**Signing out clears the token and deliberately does not clear the key** — the
key was minted for this machine and goes on working, and revoking it is a
decision for the keys page rather than a side effect of closing a session.

**Your password is not stored at all.** It is an argument to one function, it is
sent once, and `app/src/SignIn.tsx` drops it the moment the request returns —
before the result is looked at, so no error path can reach it. It is not in a
ref, not in `localStorage`, and not in anything rendered.

None of this is reachable by the agent. There is no Tauri command behind any of
it, so there is nothing new to keep out of the tool schema below: the model
cannot read the token, mint a key, or see the password.

Treat both credentials as you would any API key on a machine you control:
anyone who can use your user account can read them.

---

**The dev-server pane** (`app/src/BrowserPanel.tsx`) loads one address in a
sandboxed `<iframe>`, and only an address on this machine — `localhost`,
`127.0.0.1`, `[::1]` or a `*.localhost` name, on any port — which
`app/src/browser.ts` enforces on every address typed, found in the terminal or
read back from storage, and which the policy's `frame-src` repeats. The framed
page is another origin: it cannot read the app's storage, where your key lives,
and it has no Tauri command bridge. Nothing in the frame reaches the model.

## What can write to your disk

**One function does all of the model's writing.** Every byte of content the
model proposed goes through `apply_write` in `app/src-tauri/src/lib.rs`, reached
from the frontend through a single wrapper, `applyWrite` in `app/src/disk.ts`.
That is the claim the rule at the top of this document rests on, and it is the
one worth checking.

**It is not the only code in this app that writes to disk**, and saying it was
would be the easiest sentence here to disprove — one `grep` for `fs::write` in
`lib.rs` does it. The others are all things *you* start, from a button or a menu
item, and every one of them is absent from the tool schema below:

- `create_file`, `create_dir`, `rename_path`, `delete_path` — new, rename and
  delete in the file tree. None of them carries any content; the names come from
  a dialog you typed into, and both ends of a rename go through `resolve()`.
- `export_write` — a markdown transcript of a chat, to the path an OS save panel
  returned. This is the one that puts model-written *text* on disk outside
  `apply_write`, and the reason it is allowed to skip containment is in
  `lib.rs`'s own comment on it: the path is the save panel's, the content is a
  conversation you have been reading, and what it produces is a record rather
  than something that runs.
- `history_restore`, `checkpoint_restore`, `checkpoint_redo` — putting a file
  back to a version this app already recorded, from the File History panel or an
  undo button.
- `draft_save`, `draft_clear`, `checkpoint_save`, `store_empty` — these write
  in the app data directory, never in your project. `store_empty` is the one
  that only removes: it is the Storage tab in Settings emptying one whole store,
  and it takes a three-valued enum rather than a path, so there is no directory
  name for it to be pointed at. See *What is stored outside your project*.

**And the model cannot call it.** The tool schema in `app/src/agent.ts` has
exactly eight names:

```
read-only:   list_tree    read_file   find_symbol   search
everything:  write_file   edit_file   run_command   remember
```

`apply_write` is not among them. Neither are `create_file`, `create_dir`,
`rename_path`, `delete_path`, `git_create_branch`, `git_commit`, `export_write`,
`draft_save`, `draft_clear`, `history_restore`, `history_forget`,
`history_forget_all`, `checkpoint_save`, `checkpoint_restore`, `checkpoint_redo`,
`store_sizes`, `store_empty`,
`capture_screenshot`, `set_global_shortcut`, `watch_start`, `watch_stop`,
`mcp_start`, `mcp_stop`, `mcp_call`, or any of `pty_open` / `pty_write` /
`pty_resize` / `pty_close`. Every one of those exists in Rust and is reachable
only from a button a person pressed.

That is not a description of current practice. It is an assertion in
`app/test/modes.test.mjs`, which fails `npm test` if any of those names appears
in the schema — and which also fails if a newly added tool joins neither the
read-only half nor the other one, so the question cannot be skipped. (`npm test`
is the gate it fails, not `npm run build`, which is `tsc --noEmit` and Vite and
runs no tests.) The check itself is a missing capability, not an instruction in
a prompt.

**`write_file` and `edit_file` do not write.** They compute the resulting
content and leave it in a staging area (`app/src/pending.ts`); the diff appears
in the review pane and the disk is untouched until you approve it. You can
approve a whole file or individual hunks (`app/src/Review.tsx`,
`Pending.applyPartial`). `remember` is the same mechanism pointed at `VYLO.md`,
so a fact the agent wants to keep is a diff you read first.

**An approval cannot go stale behind your back.** `apply_write` takes
`expect_sha256` and refuses the write when the file has changed since the
proposal was prepared, rather than overwriting what you did in the meantime.
`Pending.apply` passes the hash of the version the diff was built against; a
file being created passes an empty hash, which means "this must not exist yet".
Proved by `apply_write_refuses_a_file_that_moved_since_the_change_was_prepared`
in `lib.rs`.

**Nothing escapes the open folder.** Every path the model supplies goes through
`resolve()` in `lib.rs`, which canonicalises both the root and the target and
refuses anything that does not start with the root — so `..` and symlinks
*resolve* rather than being pattern-matched, and a file that does not exist yet
is checked through its parent.

There are **three** deliberate exceptions, and what they have in common is that
the path is one you chose rather than one the model supplied. `read_image` and
`read_text_attachment` read a file you dragged in or picked — both say so in
their doc comments in `lib.rs`. `export_write` *writes* to an absolute path,
which is the save panel's. All three are absent from the tool schema, so no tool
call reaches any of them however the model is prompted.

**Size limits.** The agent will not read a file over 512 KB. The editor shows
the first 2 MB of a larger file and goes read-only, because saving a buffer that
holds only the head of a file would silently destroy the rest.

---

## What can run a command

`run_command` **is** in the tool schema, and that is the design rather than an
oversight: the model may ask. The request then suspends the agent loop on a
promise until you answer (`askToRun` in `app/src/App.tsx`, `runTool` in
`app/src/agent.ts`). You are shown the exact string, the reason given for it,
and the folder it would run in. Nothing is expanded, rewritten or interpreted
between that dialog and the shell.

The shell is `sh -c` on macOS and `cmd /C` on Windows, in the open folder, with
a 120-second default timeout, output capped at the last 60,000 characters of
each stream, and the child killed if it overruns (`run_command` in `lib.rs`).
There is no allow-list of permitted commands. The gate is that you read it.

**"Always allow this"** exists, and here is exactly what it does: it remembers
that one command string for the rest of the session, matched exactly, in memory
only. It is never written to disk, it is cleared when you open a different
folder, and trusting `npm test` does not also trust `npm test && rm -rf ~`
(`trusted` in `App.tsx`).

**"Run in terminal"** puts the same, already-approved string on a surface you
can watch and interrupt. It is not a second decision.

**MCP tool calls go through the same dialog.** `.vylo/mcp.json` lives in the
project, so it arrives with the project, and a repository you cloned can name
any command it likes — which is why reading that file starts nothing. A server
spawns only from a button, after its exact command is on screen, and the
approval is stored against a fingerprint of the command and its arguments, so
editing the config asks again (`app/src/mcp.ts`, `app/src-tauri/src/mcp.rs`).
A call to one of its tools then goes through the dialog above, because a
third-party tool's side effects are not visible from its name.

**Read the caveat above twice for MCP.** The dialog offers **Always allow this**
for an MCP call exactly as it does for a shell command, and it behaves the same
way: it remembers one exact string, which for MCP is
`server: tool({"the":"arguments"})` — built by `runTool` in `app/src/agent.ts` —
in memory, until you open a different folder. A repeat of a
call you allowed — same server, same tool, byte-identical arguments — then runs
without asking again. Anything that differs by one character asks.

### Why the terminal has no approval step

The integrated terminal (`app/src-tauri/src/pty.rs`) runs a real login shell
with no gate at all, and that is consistent with the rule rather than an
exception to it. The rule is about who *authors* a command. You typing into a
shell on your own machine is you; asking you to approve your own keystrokes
would be theatre, exactly as it would be in the code editor or the memory
editor.

What holds the line is that the model cannot type into it. `pty_open`,
`pty_write`, `pty_resize` and `pty_close` are absent from the tool schema. The
bridge is one-way: you can press **Send to chat** to hand terminal output to the
agent, and there is deliberately no reverse. The only model-authored string that
can ever reach a terminal is one you already approved in the dialog and then
chose to run there.

### The terminal reads your shell history

Since 0.80.0 the completion list is seeded from your shell's own history file —
`$HISTFILE` if you have exported one, then `~/.zsh_history`, `~/.bash_history`,
`~/.local/share/fish/fish_history`, first one with anything in it. It is what
makes the list able to finish `claude --dang` into a line you have run fifty
times, rather than only lines you have typed into that pane since it opened.

Three things about it:

- **It only reads.** That file belongs to the shell, which rewrites it on exit,
  and an app editing it would be an app corrupting your history to save you
  four keystrokes. `shell_history` in `pty.rs` opens it read-only and there is
  no writer anywhere in this application.
- **Nothing leaves the machine.** The lines go into a list on screen, in the
  window of the person whose history it is. No request in the table above
  carries them, and the model is never given them — `shell_history`,
  `shell_commands` and `complete_path` are absent from the tool schema exactly
  as the `pty_*` commands are.
- **Lines that look like they carry a credential are dropped** — `PASSWORD=`,
  `TOKEN=`, `Authorization:`, `mysql -pHunter2`, `curl -u user:pass` and
  similar. Read `looks_secret` before trusting that sentence: it is pattern
  matching over arbitrary command lines and it will miss things. What it cannot
  do is make anything worse, because a line it misses is offered exactly as
  your own Up arrow would offer it. It is there because a suggestion appears
  *unprompted*, four keystrokes in, and Up does not.

If you would rather it read nothing, the file it reads is yours: point
`HISTFILE` at `/dev/null` for the app's shell, or clear the history file.

The screenshot button starts a process without asking, and earns that by having
nothing to approve: every flag is a compile-time constant and the mode is a
two-variant enum rather than a string, so there is no argument for anything to
arrive in (`app/src-tauri/src/capture.rs`). You drag the rectangle yourself,
which is what makes the capture yours.

On macOS the program is an absolute path, `/usr/sbin/screencapture`, and
`capture.rs` says why in a comment: the app inherits your environment, so a
`screencapture` earlier in your `PATH` would be somebody else's program running
with no approval. On Windows the plan is `cmd /C start "" ms-screenclip:`, and
`cmd` there **is** resolved through `PATH` like any other Windows process
launch.

---

## What is stored outside your project

Three stores live in the app data directory, never in the folder you are editing
— history of a change showing up as another change would be absurd:

- **macOS** — `~/Library/Application Support/com.vylo.editor`
- **Windows** — `%APPDATA%\com.vylo.editor`

That is Tauri's `app_data_dir()` for this app's identifier — `store()` in
`app/src-tauri/src/lib.rs` asks for it, and `identifier` in `tauri.conf.json` is
what names it.

**Settings → Storage** lists all four, says how much each is using, and empties
any of them behind a confirmation that names what goes. Until 0.52.1 the
checkpoint store had no such button, and the last column of this table said so.
It has one now.

| Store | What it holds | Cap | How to clear it |
|---|---|---|---|
| `drafts/` | unsaved editor buffers, so a crash does not lose them | swept after 30 days untouched | **Empty** in Settings → Storage; **Discard them** on the recovery banner; also cleared on a clean quit |
| `checkpoints/` | the contents of files before an approved write, plus the conversation tail, so an undo puts both back | 60 per chat, 32 MB per chat, chat directories removed after 30 days untouched | **Empty** in Settings → Storage |
| `history/` | every version this app has written, so saving over your own work is recoverable | 32 MB per folder, 30 days; a single version over 4 MB is not recorded | **Empty** in Settings → Storage; or **Forget this file’s history** / **Forget everything in this folder**, in the File History panel |

**Clipboard history is not one of them**, which matters if you came to this
section to delete it. It is kept in the webview's `localStorage` under the key
`vylo.clips.v1` (`localClips` in `app/src/clips.ts`) — 20 entries, 7 days, 4096
characters each, emptied by **Empty** in Settings → Storage or by **Clear** in
the clipboard picker. Deleting the app data directory does not clear it.

It is worth reading twice: **it does not poll the OS clipboard.** A history
that polls records whatever your password manager put there thirty seconds ago.
This one records only what you paste *into this app*, skips pastes into
password fields, skips what the source marked concealed, and
skips strings shaped like secrets. That last check is a courtesy and not a
guarantee — it matches shapes, so it misses a short password or a four-word
passphrase, and `app/src/clips.ts` says so in its own header.

**Terminal sessions are not one of them either**, and this one is worth
knowing about. So that a project's terminals come back when you reopen it, the
tail of what was on each terminal's screen is kept in `localStorage` under
`vylo.terminals.v1` (`app/src/scrollback.ts`) — 8 sessions per folder, 240 lines
each, 120,000 characters and 8 folders in total, emptied by **Empty** in
Settings → Storage.

That is *whatever your commands printed*: a `cat` of a config file, a token a
CLI echoed, the output of `env`. Nothing filters it, because nothing reliably
could. If something sensitive went across a terminal, empty this store.

The processes themselves are never restored and cannot be — a shell is a child
of this application and dies with it. A restored terminal shows what was there,
then a line saying the shell is new and nothing above it is running, then a
fresh prompt. That line is not dismissible: a transcript sitting above a live
prompt with nothing between them is a dead process wearing a live one's
clothes.

Chats, settings, your gateway key, your session token, which MCP servers you
enabled, any model providers you added, the clipboard history and the terminal
sessions above are in the webview's `localStorage`, not in that directory.

Nothing here is encrypted at rest beyond whatever your disk already does.

---

## What Vylo Editor does not protect you from

This is the section that decides whether the rest of this document is worth
anything.

**An approved command runs as you.** There is no sandbox, no container and no
allow-list. `sh -c` in your project folder, with your user's privileges, can
delete your home directory, push to a remote, read your SSH keys or install
something. The gate is that you read the string first. If you approve
`curl … | sh`, you have run whatever that URL served, and Vylo has done exactly
what you told it to.

**A staged diff you approve without reading is a diff you wrote.** Per-hunk
review, the stale-write guard and checkpoints all assume somebody looked. None
of them can tell a careful approval from a fast one, and a long diff at the end
of a long session is exactly where that fails.

**Prompt injection is real and is not solved.** A repository can contain text
aimed at the agent rather than at you — in a README, a comment, a test fixture,
an issue you pasted in. What holds is structural: containment is enforced in
Rust, and the dangerous verbs need a human. What does not hold is the model's
judgement, so a request that is unreasonable can arrive at the approval dialog
looking perfectly reasonable.

**An MCP server you enable is third-party code running as you.** It is a program
named in a file that arrived with the repository. Vylo shows you its command
before starting it and gates every tool call, but once it is running it is a
process on your machine with your privileges, and it can reach the network on
its own — the content security policy above constrains Vylo's window, not a
child process.

**The model can be wrong.** Confidently, plausibly, and in the middle of
otherwise correct work. It can misread code, drop a line that mattered, claim it
ran a test it only proposed, or summarise a file it did not finish reading. Vylo
makes its output reviewable. It does not make it correct.

**Git is still your undo.** Checkpoints and file history are bounded local
conveniences — capped by size, capped by age, and on this machine only. They are
not a backup.

**The app is not hardened against a compromised gateway** beyond the update
signature. A gateway that answers your requests can answer them with anything.
What it cannot do is push an unsigned build at you, or reach your files without
going through a dialog you saw.

**The builds are not yet signed.** As of 0.101.0 the macOS and Windows binaries
are not code-signed or notarised, so Gatekeeper and SmartScreen will warn about
them. That warning is correct: check where you got the app from before you
override it.

**Nothing here has been audited.** There has been no third-party security review
of this application.

---

## Reporting a security problem

Please do not open a public issue.

Report privately through GitHub's security advisory form on the repository:
<https://github.com/AvrazAkraye/vylo-editor/security/advisories/new>. It reaches
the maintainer and stays private until a fix ships.

Include what you did, what happened, and the version shown in **Settings**. If
you have found a way for model output to reach the disk or a shell without a
human approving that exact content or string, that is the bug this product cares
about most — it is worth reporting even if you are not sure it is exploitable.

---

*Last checked against 0.101.0. Every statement above was read out of the code. If
the code and this document ever disagree, the code is right and this document is
the bug.*
