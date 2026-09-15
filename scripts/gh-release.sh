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
set -euo pipefail

VERSION="$1"; FILE="$2"; ASSET="$3"; NOTES="${4:-}"
REPO="${VYLO_GH_REPO:-AvrazAkraye/vylo-editor}"
TAG="v$VERSION"

skip() { echo "    GitHub release skipped: $1"; exit 0; }

command -v gh >/dev/null 2>&1        || skip "gh is not installed"
gh auth status >/dev/null 2>&1       || skip "gh is not signed in"
[ -f "$FILE" ]                       || skip "no file at $FILE"

if ! gh release view "$TAG" --repo "$REPO" >/dev/null 2>&1; then
  echo "==> creating the GitHub release $TAG"
  gh release create "$TAG" --repo "$REPO" --title "Vylo Editor $VERSION" --latest \
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
