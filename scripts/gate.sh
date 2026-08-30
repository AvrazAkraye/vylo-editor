#!/usr/bin/env bash
#
# gate.sh — the gates, run before the commit instead of after it in CI.
#
# Two failures in one week came from committing a state that had not been
# through all of them: a red `npm test` reached main, and a CRLF bug reached
# Windows CI. Both were caught, late, by something remote. Remote is the wrong
# place to find out. This makes the commands one command.
#
#   scripts/gate.sh             everything
#   scripts/gate.sh frontend    npm test, npm run build   — what pre-commit runs
#   scripts/gate.sh rust        cargo test
#   scripts/gate.sh notices     scripts/notices.sh --check
#   scripts/gate.sh -v ...      stream each command live instead of capturing it
#
# Stops at the first gate that fails, prints that gate's output in full, and
# exits non-zero. A gate that passes prints one line.
#
# THE ORDER IS CHEAPEST FIRST, and these are measured on this repo, warm:
#
#   npm test        ~2.3 s    1397 assertions, no compiler in the loop
#   npm run build   ~3.5 s    tsc --noEmit, then vite
#   cargo test      ~2.5 s warm, minutes cold
#   notices --check ~1.4 s warm
#
# `notices` breaks the cheapest-first rule deliberately and runs LAST. It is not
# a check on the code — it asks whether THIRD_PARTY_NOTICES.md still matches the
# dependency tree, which only a lockfile change can falsify — and it shells out
# to `cargo metadata` for all three shipped targets, so putting it after
# `cargo test` means the registry is already warm when it runs. Ordering it
# first would spend its 1.4 s ahead of the failures people actually cause.
#
# `npm test` leads because it is the fastest and because its esbuild bundling
# rejects a syntax error before tsc has to. `cargo test` is last because it is
# the only one whose cost is unbounded: a cold or cleared target/ rebuilds the
# whole Tauri dependency tree, and 15 GB of it is what makes the warm number
# look cheap.
#
# Those are measurements, not guarantees. `npm test` is one npm script, so a
# lane added to it — an e2e suite, say — lands here automatically and shifts the
# numbers. If it ever costs more than `cargo test` warm, re-order this file, and
# reconsider what the commit hook can afford.
#
# There is no separate line-endings check. The CRLF bug that reached Windows CI
# was a catalogue regex that could not match across `\r\n`, and `test/i18n.test.mjs`
# now re-parses the catalogue with CRLF endings and asserts it comes out
# identical — so `npm test` is that check, on every platform.

set -uo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
APP="$ROOT/app"

WHICH=all
VERBOSE=0
for arg in "$@"; do
  case "$arg" in
    all|frontend|rust|notices) WHICH="$arg" ;;
    -v|--verbose)      VERBOSE=1 ;;
    -h|--help)
      echo "usage: gate.sh [all|frontend|rust|notices] [-v]"
      echo "  all       npm test, npm run build, cargo test, notices   (default)"
      echo "  frontend  npm test, npm run build"
      echo "  rust      cargo test"
      echo "  notices   scripts/notices.sh --check"
      exit 0 ;;
    *) echo "gate.sh: unknown argument '$arg' (try -h)" >&2; exit 2 ;;
  esac
done

# ---------------------------------------------------------------------------
# One gate run at a time, per checkout.
#
# This is not tidiness. Two `cargo test` runs in the same checkout genuinely
# fail each other: the watch tests build their fixtures at a FIXED path
# (`$TMPDIR/vylo_watch_<name>`, see `tmp()` in src-tauri/src/watch.rs) and clear
# it on the way in, so the second run's setup deletes the first run's tree
# mid-test. Reproduced here as a NotFound panic in
# `says_nothing_about_a_dependency_tree`. The frontend gates share mutable
# directories the same way — `app/.test-build` and `app/dist`.
#
# A hook that goes red for a reason the committer did not cause gets deleted, so
# the lock waits rather than colliding — and, if the wait runs out, it proceeds
# rather than failing. The lock lives in the temp dir, keyed on the checkout
# path, so it never appears in `git status`. It serialises gate.sh only: two
# agents running `cargo test` by hand still collide.
# ---------------------------------------------------------------------------
LOCK="${TMPDIR:-/tmp}/vylo-gate-$(printf '%s' "$ROOT" | cksum | awk '{print $1}').lock"
LOCKED=0
WAIT_LIMIT=300

release_lock() {
  if [ "$LOCKED" = 1 ]; then rm -rf "$LOCK"; LOCKED=0; fi
  return 0
}
trap release_lock EXIT

acquire_lock() {
  local waited=0 holder=
  while ! mkdir "$LOCK" 2>/dev/null; do
    holder=$(cat "$LOCK/pid" 2>/dev/null)
    if [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null; then
      rm -rf "$LOCK"          # the holder is gone; the lock is not a lock
      continue
    fi
    # No pid at all, three seconds after we first looked. The pid is written on
    # the line after the mkdir, so this is a run that was killed -9 in between,
    # and there is nothing alive to wait for. Without this the next commit hangs
    # for the full WAIT_LIMIT, which is how a hook earns being deleted.
    if [ -z "$holder" ] && [ "$waited" -ge 3 ]; then
      echo "==> clearing an abandoned lock (no owner)"
      rm -rf "$LOCK"
      continue
    fi
    if [ "$waited" = 0 ]; then
      echo "==> another gate run is in progress; waiting for it"
    fi
    sleep 1
    waited=$((waited + 1))
    if [ "$waited" -ge "$WAIT_LIMIT" ]; then
      echo "==> lock still held after ${WAIT_LIMIT}s; running anyway"
      return 0
    fi
  done
  echo $$ >"$LOCK/pid" 2>/dev/null
  LOCKED=1
}

# run <label> <dir> <command...>
#
# A status listed in $SOFT is reported and forgiven instead of failing the gate.
# Exactly one lane uses it — see `notices` below — and only for the status that
# means "the inputs could not be gathered on this machine", which is not a
# finding about the tree and is not the committer's to fix.
SOFT=""
run() {
  local label="$1" dir="$2"
  shift 2
  local log status=0 started="$SECONDS" took
  log="$(mktemp "${TMPDIR:-/tmp}/vylo-gate.XXXXXX")" || log="${TMPDIR:-/tmp}/vylo-gate.$$"

  printf '==> %-14s' "$label"
  if [ "$VERBOSE" = 1 ]; then
    printf '\n'
    ( cd "$dir" && "$@" ) 2>&1 | tee "$log"
    status=${PIPESTATUS[0]}
  else
    ( cd "$dir" && "$@" ) >"$log" 2>&1 || status=$?
  fi
  took=$(( SECONDS - started ))

  if [ "$status" = 0 ]; then
    [ "$VERBOSE" = 1 ] && printf '==> %-14s' "$label"
    printf 'ok (%ss)\n' "$took"
    rm -f "$log"
    return 0
  fi

  for soft in $SOFT; do
    if [ "$status" = "$soft" ]; then
      [ "$VERBOSE" = 1 ] && printf '==> %-14s' "$label"
      printf 'skipped (%ss) — could not run here\n' "$took"
      if [ "$VERBOSE" != 1 ]; then
        echo
        cat "$log"
        echo
      fi
      rm -f "$log"
      return 0
    fi
  done

  [ "$VERBOSE" = 1 ] && printf '==> %-14s' "$label"
  printf 'FAILED (%ss, exit %s)\n' "$took" "$status"
  if [ "$VERBOSE" != 1 ]; then
    echo
    cat "$log"
    echo
  fi
  rm -f "$log"
  echo "==> gate failed: $label   (in $dir)"
  exit 1
}

acquire_lock

case "$WHICH" in
  all|frontend)
    if [ ! -d "$APP/node_modules" ]; then
      echo "gate.sh: app/node_modules is missing. Run 'npm ci' in $APP first." >&2
      exit 2
    fi
    run "npm test"      "$APP" npm test
    run "npm run build" "$APP" npm run build
    ;;
esac

case "$WHICH" in
  all|rust)
    if ! command -v cargo >/dev/null 2>&1; then
      echo "gate.sh: cargo is not on PATH. Install Rust, or run 'scripts/gate.sh frontend'." >&2
      exit 2
    fi
    run "cargo test" "$APP/src-tauri" cargo test
    ;;
esac

# THIRD_PARTY_NOTICES.md is a compliance document, and the one failure mode it
# has is going stale on a dependency bump without anyone noticing — which is
# exactly what an unrun checker guarantees. `notices.sh --check` existed and was
# called by nothing; this is the call.
#
# Exit 3 from it means the inputs could not be gathered (no node_modules, or a
# `cargo metadata --offline` for a target whose crates this machine has never
# fetched). That says nothing about the file, so it is reported and forgiven.
# Only a genuine diff — exit 1 — stops the gate.
case "$WHICH" in
  all|notices)
    SOFT=3
    run "notices" "$ROOT" bash "$ROOT/scripts/notices.sh" --check
    SOFT=""
    ;;
esac

echo "==> green"
