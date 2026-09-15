#!/usr/bin/env bash
#
# Build, install and publish a macOS release — with the checks that a plain
# `tauri build && scp` does not do.
#
# The one that matters: `bundle_dmg.sh` runs BEFORE the updater tarball, so when
# it fails (a stale /Volumes/dmg.* mount is the usual cause) the build stops
# with the .app rebuilt and the tarball left over from the PREVIOUS version.
# Uploading that publishes the old build under the new version number, and
# nothing about the manifest looks wrong. This script refuses to get that far.
set -euo pipefail

# The server these publish to is deliberately not in this repository. It is
# infrastructure: a public repository should not hand out its address or the
# account that logs into it. Put both in `scripts/.release.env`, which is
# ignored by git — `docs/RELEASING.md` says what goes in it.
HERE_ENV="$(cd "$(dirname "$0")" && pwd)/.release.env"
# shellcheck disable=SC1090
[ -f "$HERE_ENV" ] && . "$HERE_ENV"
HOST="${VYLO_UPDATE_HOST:?set VYLO_UPDATE_HOST (e.g. user@host) in scripts/.release.env}"
REMOTE="${VYLO_UPDATE_DIR:?set VYLO_UPDATE_DIR (e.g. /opt/<gateway>/updates) in scripts/.release.env}"
BASE="https://capi.vylo-tech.com/updates"
HERE="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$(cd "$HERE/../app" && pwd)"
BUNDLE="$APP_DIR/src-tauri/target/release/bundle/macos"
NOTES="${1:-}"

cd "$APP_DIR"
VERSION=$(node -p "require('./package.json').version")
echo "==> Vylo Editor $VERSION"

# A leftover mount is what makes bundle_dmg.sh fail. Clear it rather than
# discovering the consequence three steps later.
for v in /Volumes/dmg.*; do
  [ -e "$v" ] || continue
  echo "==> detaching stale $v"
  hdiutil detach "$v" -force >/dev/null 2>&1 || true
done
rm -f "$BUNDLE"/rw.*.dmg "$APP_DIR/src-tauri/target/release/bundle/dmg"/rw.*.dmg 2>/dev/null || true

echo "==> tests"
npm test >/dev/null
(cd src-tauri && cargo test --quiet >/dev/null)

echo "==> build"
: "${TAURI_SIGNING_PRIVATE_KEY:=$(cat ~/.tauri/vylo-editor.key)}"
export TAURI_SIGNING_PRIVATE_KEY
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="${TAURI_SIGNING_PRIVATE_KEY_PASSWORD:-}"
npx tauri build

# The check this script exists for.
BUILT=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$BUNDLE/Vylo Editor.app/Contents/Info.plist")
[ "$BUILT" = "$VERSION" ] || { echo "the built .app is $BUILT, expected $VERSION"; exit 1; }

TMP=$(mktemp -d)
tar xzf "$BUNDLE/Vylo Editor.app.tar.gz" -C "$TMP"
TARRED=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$TMP/Vylo Editor.app/Contents/Info.plist")
rm -rf "$TMP"
[ "$TARRED" = "$VERSION" ] || {
  echo "the updater tarball contains $TARRED, not $VERSION — it was not regenerated."
  echo "That is the stale-artifact failure: check whether the dmg step errored."
  exit 1
}

echo "==> installing to /Applications"
pkill -x "Vylo Editor" 2>/dev/null || true
rm -rf "/Applications/Vylo Editor.app"
cp -R "$BUNDLE/Vylo Editor.app" /Applications/
xattr -cr "/Applications/Vylo Editor.app"

echo "==> publishing"
"$HERE/push-update.sh" darwin-aarch64 \
  "$BUNDLE/Vylo Editor.app.tar.gz" "$BUNDLE/Vylo Editor.app.tar.gz.sig" "$VERSION" "$NOTES"

echo "==> verifying the served build says $VERSION"
TMP=$(mktemp -d)
curl -sf -o "$TMP/t.tar.gz" "$BASE/files/vylo-editor-$VERSION-darwin-aarch64.app.tar.gz"
tar xzf "$TMP/t.tar.gz" -C "$TMP"
SERVED=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$TMP/Vylo Editor.app/Contents/Info.plist")
rm -rf "$TMP"
[ "$SERVED" = "$VERSION" ] || { echo "the served tarball contains $SERVED, not $VERSION"; exit 1; }

# The front door, after the update channel: somebody who has never installed
# the app downloads the .dmg from the repository page, and it is the same build
# just verified above rather than a second one nobody checked.
#
# Push before running this. The release carries a tag, and a tag can only point
# at a commit the remote already has — so an unpushed release commit is skipped
# with a message rather than tagged onto whatever the remote's head happens to
# be, which is what put `v0.60.0` on the 0.59.0 source.
"$HERE/gh-release.sh" "$VERSION" \
  "$(dirname "$BUNDLE")/dmg/Vylo Editor_${VERSION}_aarch64.dmg" \
  "Vylo-Editor-macOS-AppleSilicon.dmg" "$NOTES"

open -a "/Applications/Vylo Editor.app"
echo "==> $VERSION published and verified end to end"
echo "    Windows: gh workflow run build.yml --ref main, then scripts/publish-windows.sh <run-id>"
