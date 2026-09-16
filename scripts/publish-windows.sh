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

HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE/.."
# The version this publishes is the artifact's own, not the working tree's.
#
# It used to be read from package.json, and that made a race out of an ordinary
# afternoon: CI takes seven minutes, the next release gets committed in the
# meantime, and the publish that was waiting on the build then refused it as
# "not 0.71.0" — correctly, but the build it was refusing was exactly the one
# it had been asked for. A run id names a build, and a build knows what it is.
VERSION=""
RUN="${1:-}"
if [ -z "$RUN" ]; then
  RUN=$(gh run list --workflow=build.yml --status=success --limit=1 --json databaseId --jq '.[0].databaseId')
  [ -n "$RUN" ] || { echo "no successful build to publish from"; exit 1; }
  # With no run named, the tree is the only statement of intent there is, and
  # the check below still has to hold: "whatever CI built last" is not a thing
  # anybody meant to publish if it is not what they are working on.
  VERSION=$(node -p "require('./app/package.json').version")
fi
[ -n "$VERSION" ] && echo "==> Vylo Editor $VERSION from run $RUN"

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
gh run download "$RUN" -n vylo-editor-x86_64-pc-windows-msvc -D "$TMP" >/dev/null

# Tauri v2's Windows updater artifact is the NSIS installer itself, with a .sig
# beside it — not the `.nsis.zip` that v1 produced and that tauri-action still
# names in its logs. The zip is tried first anyway, so this keeps working if a
# future version brings it back.
ZIP=$(find "$TMP" -name '*-setup.nsis.zip' | head -1)
[ -n "$ZIP" ] || ZIP=$(find "$TMP" -name '*-setup.exe' | head -1)
if [ -z "$ZIP" ]; then
  echo "that run has no Windows updater artifact. It contains:"
  find "$TMP" -type f | sed "s|$TMP/|  |"
  echo "If the .sig files are missing, the CI upload is dropping them --"
  echo "the bundle directory should be uploaded whole, not globbed per type."
  exit 1
fi
SIG="$ZIP.sig"
[ -f "$SIG" ] || { echo "the updater archive is unsigned; check TAURI_SIGNING_PRIVATE_KEY in CI"; exit 1; }

# Tauri names its output `Vylo Editor_0.71.0_x64-setup.exe`, so the build says
# which version it is and there is nothing to disagree with.
BUILT=$(basename "$ZIP" | sed -E 's/.*_([0-9]+\.[0-9]+\.[0-9]+)_.*/\1/')
[ -n "$BUILT" ] && [ "$BUILT" != "$(basename "$ZIP")" ] \
  || { echo "cannot tell what version $(basename "$ZIP") is"; exit 1; }

if [ -n "$VERSION" ]; then
  # No run was named, so "the last successful build" had better be the thing
  # being worked on — see above.
  [ "$BUILT" = "$VERSION" ] \
    || { echo "the last successful build is $BUILT, not $VERSION — dispatch CI on the current commit, or name a run id"; exit 1; }
else
  VERSION="$BUILT"
  echo "==> Vylo Editor $VERSION from run $RUN"
fi

"$HERE/push-update.sh" windows-x86_64 "$ZIP" "$SIG" "$VERSION"

# The download a person clicks is the installer itself, never the `.nsis.zip`
# the updater may prefer: somebody on the releases page needs something they
# can run, and `$ZIP` is whichever of the two this Tauri version publishes.
EXE=$(find "$TMP" -name '*-setup.exe' | head -1)
"$HERE/gh-release.sh" "$VERSION" "$EXE" "Vylo-Editor-Windows-x64-setup.exe"

echo "==> a Windows client on an older version is now offered:"
curl -s "https://capi.vylo-tech.com/updates/windows/x86_64/0.0.1" \
  | python3 -c 'import json,sys; d=json.load(sys.stdin); print("   ", d["version"], d["platforms"].get("windows-x86_64",{}).get("url","MISSING"))'
