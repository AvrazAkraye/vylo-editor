# Building Windows without paying for it

GitHub's hosted runners are metered. A runner you own is not. The workflow reads
a repository variable, so switching between them is one setting and no code.

## What you need

A Windows 10 or 11 machine — a laptop, a desktop, a VM on this Mac, anything
that can be switched on when you want to publish. It does not need to be fast
and it does not need to be always on: a build takes about fifteen minutes and
the job simply waits until the runner appears.

## Once, on that machine

1. On GitHub: **Settings → Actions → Runners → New self-hosted runner →
   Windows**. It gives you four commands; run them in PowerShell in a folder
   like `C:\actions-runner`.
2. When it asks for labels, accept the defaults.
3. `./run.cmd` to start it, or `./svc.cmd install` then `./svc.cmd start` to have
   it run as a service so it comes back after a reboot.

Then install what Tauri needs to build:

- **Rust** — https://rustup.rs, choose the MSVC toolchain
- **Visual Studio Build Tools** with "Desktop development with C++"
- **Node.js 20 or newer** — https://nodejs.org
- **WebView2** — already present on Windows 11 and on updated Windows 10

## Once, on GitHub

**Settings → Secrets and variables → Actions → Variables → New variable**

    Name   WINDOWS_RUNNER
    Value  self-hosted

That is the whole switch. To go back to hosted runners, delete the variable.

## What this does and does not change

It removes the only metered part. The workflow, the secrets, the signing key and
the artifacts are identical — the job just runs on your hardware instead of
Microsoft's.

It does not remove the reason CI exists. Windows binaries cannot be built on a
Mac, because Tauri needs the target's own toolchain and WebView2 headers. The
runner is how the `.exe` gets made; it is not a convenience.

## The alternative, if you would rather not run a service

Build on the Windows machine by hand: clone the repo, `npm ci`,
`npx tauri build --target x86_64-pc-windows-msvc`, and copy the installer back.
You then also need the updater signing key on that machine — it lives at
`~/.tauri/vylo-editor.key` here and as a GitHub secret, and it is deliberately
not on the update server. `docs/RELEASING.md` has the details.

A self-hosted runner is the same work done once instead of every release.
