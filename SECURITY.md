# Security policy

GitHub looks for this file, and links it from the repository's **Security** tab
and from the "Report a vulnerability" prompt on a new issue. Without it neither
appears, and the reporting instructions in [SAFETY.md](SAFETY.md) are only found
by someone who already went looking. That is the whole reason this file is
separate from that one.

## Supported versions

Vylo Editor ships as a single desktop application with auto-update. Only the
latest released version is supported; the version you are running is shown in
**Settings**.

## Reporting a vulnerability

**Please do not open a public issue.**

Report privately through GitHub's security advisory form:
<https://github.com/AvrazAkraye/vylo-editor/security/advisories/new>. It reaches
the maintainer and stays private until a fix ships.

Include what you did, what happened, and the version shown in **Settings**.

## What this product cares about most

The whole design rests on one rule:

> No model output reaches disk or a shell without a human having read and
> approved that exact content or string.

If you have found a way around it — model-authored content on disk, or a string
in a shell, that no human approved verbatim — that is the report this project
most wants, and it is worth sending even if you are not sure it is exploitable.

[SAFETY.md](SAFETY.md) documents where that rule is enforced, and, in *What Vylo
Editor does not protect you from*, what it deliberately does not cover. Reading
that section first will tell you whether what you found is a bug or a documented
limit. It is also available in
[العربية](SAFETY.ar.md) · [کوردیی ناوەندی](SAFETY.ckb.md) ·
[کوردیا بادینی](SAFETY.kmr.md).

## What is out of scope

- The absence of code signing. As of 0.111.0 the macOS and Windows binaries are
  not signed or notarised, and SAFETY.md says so. It is known and tracked.
- Anything an approved `run_command` does. There is no sandbox and no
  allow-list; that is stated, and the gate is that a human read the string.
- A third-party MCP server's own behaviour once you have started it.
