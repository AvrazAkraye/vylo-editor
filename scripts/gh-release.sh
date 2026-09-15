#!/usr/bin/env bash
#
# Put a built installer on the GitHub release for this version.
#
# The gateway is the update channel: an app already installed never comes here.
# This is the front door — somebody who has never run Vylo Editor, reading the
# repository page, needs a file to download. Both are fed from the same bytes,
# because a download that differs from what the updater would hand you is a
# second build nobody tested.
#
# Idempotent by design. The release is created by whichever platform publishes
# first and each one adds its own file as it becomes available, so macOS and
# Windows can publish hours apart — which they do, because Windows waits for CI
# — without either clobbering the other's work.
#
# Asset names carry no version. `/releases/latest/download/<name>` then keeps
# working for ever, which is what the README links to; the tag, the title and
# the app itself all still say which version it is.
#
# Never fatal. By the time this runs the release is already live on the
# gateway, so a missing `gh`, an expired login or a network failure must not
# fail the publish that already succeeded. It says what it skipped and returns.
#
# ## The tag has to be pinned, and this is why
#
# `gh release create` with no `--target` tags the *remote's* current head. This
# script runs inside a publish, which happens before the push — so every tag it
# made pointed at the previous release's commit: `v0.60.0` sat on the 0.59.0
# source, and so did the two before it. Nothing downstream noticed, because the
# installers are uploaded by name and never read back from the tag. Somebody
# checking out `v0.60.0` to see what they were running would have read the
# wrong code, which is the whole purpose of a tag.
#
# So the commit is named explicitly, and a commit the remote has never seen is
# a skip rather than a tag in the wrong place: push first, then publish.
set -euo pipefail

VERSION="$1"; FILE="$2"; ASSET="$3"; NOTES="${4:-}"
REPO="${VYLO_GH_REPO:-AvrazAkraye/vylo-editor}"
TAG="v$VERSION"

skip() { echo "    GitHub release skipped: $1"; exit 0; }

command -v gh >/dev/null 2>&1        || skip "gh is not installed"
gh auth status >/dev/null 2>&1       || skip "gh is not signed in"
[ -f "$FILE" ]                       || skip "no file at $FILE"

SHA="$(git rev-parse HEAD 2>/dev/null || true)"
[ -n "$SHA" ] || skip "not in a git checkout, so there is no commit to tag"

if ! gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  gh api "repos/$REPO/commits/$SHA" >/dev/null 2>&1 \
    || skip "$SHA is not on the remote yet — push, then re-run scripts/gh-release.sh"
  echo "==> creating the GitHub release $TAG at ${SHA:0:8}"
  gh release create "$TAG" --repo "$REPO" --target "$SHA" --title "Vylo Editor $VERSION" --latest \
     --notes "${NOTES:-Vylo Editor $VERSION}

Download the file for your system below. The app updates itself afterwards, so
this is the last time you download it by hand.

Neither binary is code-signed, so both systems warn on first launch: on macOS
right-click the app and choose *Open*, then *Open* again; on Windows choose
*More info*, then *Run anyway*. Read SAFETY.md before pointing it at a folder
that matters." >/dev/null || skip "could not create $TAG"
fi

# `gh` names the asset after the file, and `#label` only sets the caption — so
# the rename has to happen on disk, in a copy, leaving the build output alone.
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp "$FILE" "$TMP/$ASSET"
gh release upload "$TAG" --repo "$REPO" --clobber "$TMP/$ASSET" >/dev/null \
  || skip "could not upload $ASSET to $TAG"
echo "==> $ASSET is on https://github.com/$REPO/releases/tag/$TAG"
