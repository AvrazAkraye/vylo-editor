# Contributing

Five things. Everything else you can find by reading the code.

## 1. The three gates

Nothing is committed that has not been through all three:

```bash
cd app && npm test          # 1397 assertions           ~2.3 s
cd app && npm run build     # tsc --noEmit, then vite   ~3.5 s
cd app/src-tauri && cargo test   # 109 tests            ~2.5 s warm
```

Or, as one command from the repo root, in the order that fails cheapest first:

```bash
scripts/gate.sh            # all three          ~10 s warm
scripts/gate.sh frontend   # the first two      ~5 s
scripts/gate.sh rust       # cargo test
scripts/gate.sh -v         # stream the output instead of capturing it
```

It stops at the first gate that fails and prints that gate's output in full.

**`cargo test` is the one with an unbounded cost.** Warm it is seconds; a cold
or cleared `target/` rebuilds the whole Tauri dependency tree, and the warm
number is resting on about 15 GB of it. That is why it is not in the commit
hook.

**Do not run two gates in one checkout at once.** The Rust watch tests build
their fixtures at a fixed path (`$TMPDIR/vylo_watch_<name>`) and clear it on the
way in, so a second run's setup deletes the first run's tree out from under it
and you get a `NotFound` panic that has nothing to do with your change.
`gate.sh` takes a lock to serialise itself; two bare `cargo test` runs still
collide.

## 2. The hooks, which are opt-in

```bash
git config core.hooksPath .githooks      # install
git config --unset core.hooksPath        # uninstall
```

That is local config and is never committed, so a clone gets nothing until
somebody asks for it.

| | runs | why |
|---|---|---|
| `pre-commit` | `npm test`, `npm run build` | about five seconds — under the threshold where people start reaching for the flag |
| `pre-push` | all three | the last moment before it is somebody else's problem, and rare enough to pay for `cargo test` |

`pre-push` repeats what `pre-commit` did because `pre-commit` may never have
run: it is opt-in, it is skippable, it is skipped outright for a commit that
touches nothing under `app/`, and a rebase produces commits no hook has seen.

**Skipping is supported, deliberately:**

```bash
git commit --no-verify           # git honours this itself; the hook is not run
VYLO_SKIP_GATE=1 git commit      # for clients with no way to pass -n
```

There are real reasons to commit a red tree — bisecting, handing a broken
branch to someone else — and a gate you have to fight is one people route
around permanently. A hook that cannot be skipped gets deleted rather than
fixed.

**Both hooks gate the working tree, not the index.** They do not stash your
unstaged changes to test the staged state in isolation: a stashing hook that is
interrupted loses uncommitted work, and this repo is regularly edited by more
than one person or agent at a time. So a partially-staged commit is gated on a
state that is not exactly what you are committing. Nothing local closes that;
CI, which has a clean checkout and time, is where it is closed.

## 3. One writer per file

More than one agent works in this checkout at once, and two writers in one file
lose each other's work silently — the second write wins and nothing reports it.

So each task owns a list of files, and **writes only those**. A change that a
task needs in a file it does not own is not made; it is *proposed*, as numbered
edits, each carrying a unique anchor copied exactly out of the file as it stands
plus its replacement, for whoever owns the file to apply.

The files that attract simultaneous edits, and are worth checking ownership
before touching: `README.md`, `app/package.json`, `app/src/i18n.ts`,
`app/src/App.tsx`, `app/src/styles.css`, `app/src-tauri/Cargo.toml`,
`app/src-tauri/src/lib.rs`.

## 4. i18n is checked in both directions, and both bite

The interface ships in English, Arabic, Sorani and Badini. **The English
sentence is the key** (`t('Continue')`), so a missing translation degrades to
readable English rather than to a raw identifier. `test/i18n.test.mjs` checks:

- **Parity.** `ar`, `ckb` and `kmr` must carry identical key sets, with no
  duplicates and no empty values. A key added to one language and forgotten in
  the others is a red suite, not a UI that quietly falls back.
- **Forward — catalogue to code.** Every catalogue key must appear somewhere in
  `app/src/*.ts` / `*.tsx`. Delete a string's UI and its three translations go
  with it, or the build fails.
- **Reverse — code to catalogue.** Every literal handed to `t()` must exist in
  the catalogues. Without this a new string renders in English inside an RTL
  interface and every other check still passes. Two of them had.

Two things about that reverse check, because they are how you get past it by
accident:

- It only sees **single-quoted literals** — `t('Save')`. `t("Save")` and
  `t(label)` are invisible to it.
- It only scans the **top level** of `app/src`. There are no subdirectories
  there today; if you add one, the check stops seeing it.

**Line endings matter here.** The catalogue is parsed as text, and long entries
put their value on the following line, so a `\r` in the wrong place makes those
entries vanish from the parse. That shipped once and was found by Windows CI,
which is why the test now re-parses the catalogue with CRLF endings and asserts
it comes out identical. Do not normalise line endings in `i18n.ts` in either
direction without running `npm test` after.

## 5. The tool schema has eight names

```
list_tree  read_file  find_symbol  search  write_file  edit_file  run_command  remember
```

The rule the product rests on — *no model output reaches disk or a shell
without a human having read and approved that exact content or string* — is
enforced by those eight being the whole schema, and by what each of them can
actually do. `write_file`, `edit_file` and `remember` stage a result for review
rather than writing anything. `run_command` is in the schema on purpose: the
model may ask, and a human approves the exact string before it runs, because a
gate you can see is not the same as a missing one.

What is missing is the layer underneath. `apply_write`, every `pty_*`,
`create_file`, `delete_path`, `git_commit`, `mcp_start`, `export_write` and a
dozen more exist as Tauri commands and are **absent from the schema**, so a
button a human pressed is the only thing that reaches them.
`test/modes.test.mjs` asserts both halves: the eight, split into `READ_TOOLS`
and `WRITE_TOOLS` for Ask mode, and a named list of commands that must stay
absent. When you add a Tauri command that writes, spawns or deletes, add it to
that list — absent from the schema and absent from the list is only absent by
luck.

If you add a capability, add it as a **staged proposal, not a direct action**,
and put it on one side of that split. A new tool that lands in neither list
fails the suite, which is the point.
