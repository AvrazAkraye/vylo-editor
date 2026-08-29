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

HOST="${VYLO_UPDATE_HOST:-user@your-server}"
REMOTE="/opt/<gateway>/updates"
BASE="https://capi.vylo-tech.com/updates"
APP_DIR="$(cd "$(dirname "$0")/../app" && pwd)"
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
FILE="vylo-editor-$VERSION-aarch64.app.tar.gz"
SIG=$(cat "$BUNDLE/Vylo Editor.app.tar.gz.sig")
scp -q "$BUNDLE/Vylo Editor.app.tar.gz" "$HOST:$REMOTE/files/$FILE"
ssh "$HOST" "python3 - <<PY
import json
p='$REMOTE/latest.json'
m=json.load(open(p))
m['version']='$VERSION'
if '''$NOTES''': m['notes']='''$NOTES'''
m['platforms']['darwin-aarch64']={'signature':'''$SIG''','url':'$BASE/files/$FILE'}
json.dump(m, open(p,'w'), indent=2)
PY"

echo "==> verifying what is actually served"
TMP=$(mktemp -d)
curl -sf -o "$TMP/t.tar.gz" "$BASE/files/$FILE"
tar xzf "$TMP/t.tar.gz" -C "$TMP"
SERVED=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$TMP/Vylo Editor.app/Contents/Info.plist")
rm -rf "$TMP"
[ "$SERVED" = "$VERSION" ] || { echo "the served tarball contains $SERVED, not $VERSION"; exit 1; }

open -a "/Applications/Vylo Editor.app"
echo "==> $VERSION published and verified end to end"
