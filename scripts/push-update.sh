#!/usr/bin/env bash
#
# push-update.sh <platform-key> <artifact> <sig-file> <version> [notes]
#
# Upload one platform's updater artifact and point the manifest at it. Shared by
# publish-macos.sh and publish-windows.sh so the manifest is only written in one
# place — the two used to be separate, and a manifest written two ways drifts.
#
# The rule worth knowing about is the stale-platform sweep below.
set -euo pipefail

PLATFORM="$1"; ARTIFACT="$2"; SIGFILE="$3"; VERSION="$4"; NOTES="${5:-}"
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

[ -f "$ARTIFACT" ] || { echo "no artifact at $ARTIFACT"; exit 1; }
[ -f "$SIGFILE" ]  || { echo "no signature at $SIGFILE"; exit 1; }

EXT="${ARTIFACT##*/}"
case "$EXT" in
  *.app.tar.gz) EXT="app.tar.gz" ;;
  *.nsis.zip)   EXT="nsis.zip" ;;
  *)            EXT="${ARTIFACT##*.}" ;;
esac
FILE="vylo-editor-$VERSION-$PLATFORM.$EXT"
SIG=$(cat "$SIGFILE")

echo "==> uploading $FILE"
scp -q "$ARTIFACT" "$HOST:$REMOTE/files/$FILE"

# The manifest carries ONE version for every platform, so an entry left pointing
# at an older artifact would offer that version and install a different one.
# Rather than let the two drift, any platform whose URL does not name the
# version being published is dropped: no update for that platform is a great
# deal better than the wrong update.
ssh "$HOST" "python3 - <<PY
import json
p = '$REMOTE/latest.json'
m = json.load(open(p))
m['version'] = '$VERSION'
if '''$NOTES''':
    m['notes'] = '''$NOTES'''
plats = m.setdefault('platforms', {})
plats['$PLATFORM'] = {'signature': '''$SIG''', 'url': '$BASE/files/$FILE'}
stale = [k for k, v in plats.items() if '$VERSION' not in v.get('url', '')]
for k in stale:
    print('dropping ' + k + ', which still points at an older build')
    del plats[k]
json.dump(m, open(p, 'w'), indent=2)
PY"

echo "==> verifying the served bytes"
TMP=$(mktemp -d)
curl -sf -o "$TMP/artifact" "$BASE/files/$FILE"
A=$(shasum -a 256 "$ARTIFACT" | cut -d' ' -f1)
S=$(shasum -a 256 "$TMP/artifact" | cut -d' ' -f1)
rm -rf "$TMP"
[ "$A" = "$S" ] || { echo "what is served differs from what was built"; exit 1; }

echo "==> $PLATFORM at $VERSION is live"
