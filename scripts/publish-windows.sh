#!/usr/bin/env bash
#
# publish-windows.sh [run-id]
#
# Put the Windows build into the updater. Windows binaries cannot be built on a
# Mac, so the artifact comes from CI — but the update server is reached from
# here, because the SSH credentials for it are deliberately not in CI. So the
# split is: CI builds and signs, this machine publishes.
#
# With no run-id it takes the most recent successful build.
set -euo pipefail

cd "$(dirname "$0")/.."
VERSION=$(node -p "require('./app/package.json').version")
RUN="${1:-}"
if [ -z "$RUN" ]; then
  RUN=$(gh run list --workflow=build.yml --status=success --limit=1 --json databaseId --jq '.[0].databaseId')
  [ -n "$RUN" ] || { echo "no successful build to publish from"; exit 1; }
fi
echo "==> Vylo Editor $VERSION from run $RUN"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
gh run download "$RUN" -n vylo-editor-x86_64-pc-windows-msvc -D "$TMP" >/dev/null

# The NSIS installer is the updater artifact on Windows; Tauri writes it as a
# zip beside its signature.
ZIP=$(find "$TMP" -name '*-setup.nsis.zip' | head -1)
if [ -z "$ZIP" ]; then
  echo "that run has no Windows updater artifact. It contains:"
  find "$TMP" -type f | sed "s|$TMP/|  |"
  echo "If only the installers are there, the CI upload is dropping them --"
  echo "the bundle directory should be uploaded whole, not globbed per type."
  exit 1
fi
SIG="$ZIP.sig"
[ -f "$SIG" ] || { echo "the updater archive is unsigned; check TAURI_SIGNING_PRIVATE_KEY in CI"; exit 1; }

# CI builds whatever was committed at the time, which is not necessarily what is
# in package.json now. Publishing a mismatched build under this version is
# exactly the failure the macOS script already refuses, for the same reason.
case "$(basename "$ZIP")" in
  *"$VERSION"*) ;;
  *) echo "that run built $(basename "$ZIP"), which is not $VERSION — dispatch CI on the current commit first"; exit 1 ;;
esac

./scripts/push-update.sh windows-x86_64 "$ZIP" "$SIG" "$VERSION"

echo "==> a Windows client on an older version is now offered:"
curl -s "https://capi.vylo-tech.com/updates/windows/x86_64/0.0.1" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("   ", d["version"], d["platforms"].get("windows-x86_64",{}).get("url","MISSING"))'
