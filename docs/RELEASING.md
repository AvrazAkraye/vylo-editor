# Releasing

Updates are served by the Vylo gateway, not GitHub Releases: the repo is private,
so release assets would need a token, and a token shipped inside the app to fetch
its own updates is not a credential anyone can rotate.

## The signing key

`~/.tauri/vylo-editor.key` — **not in this repo, and not recoverable.**

Every update artifact is signed with it, and the public half is compiled into
the app. That is what stops this update channel from becoming a way to push
arbitrary code onto someone's laptop if the gateway is ever compromised: a
tampered payload fails verification before it runs.

If the key is lost, existing installs can never be updated again — they would
have to be reinstalled by hand. Back it up somewhere durable, and add it to
GitHub Actions as `TAURI_SIGNING_PRIVATE_KEY` when CI starts publishing.

## Cutting a release

1. Bump the version in **three** places, which must agree:
   `app/package.json`, `app/src-tauri/tauri.conf.json`, `app/src-tauri/Cargo.toml`

2. Build and sign:
   ```bash
   cd app
   export TAURI_SIGNING_PRIVATE_KEY="$(cat ~/.tauri/vylo-editor.key)"
   export TAURI_SIGNING_PRIVATE_KEY_PASSWORD=""
   npx tauri build
   npx tauri signer sign "src-tauri/target/release/bundle/macos/Vylo Editor.app.tar.gz"
   ```
   The `.tar.gz` is what the updater downloads; the `.dmg` is for fresh installs.

3. Publish the artifact under a version-stamped name — the files route sets
   `immutable` caching, so a name must never be reused for different bytes:
   ```bash
   scp "src-tauri/target/release/bundle/macos/Vylo Editor.app.tar.gz" \
       $VYLO_UPDATE_HOST:/opt/<gateway>/updates/files/vylo-editor-<VERSION>-darwin-aarch64.app.tar.gz
   ```

4. Update `/opt/<gateway>/updates/latest.json` with the new `version`, `notes`,
   `pub_date`, and the `signature` printed by step 2.

5. Verify before announcing:
   ```bash
   curl -s https://capi.vylo-tech.com/updates/darwin/aarch64/<PREVIOUS> | jq .version
   curl -s -o /dev/null -w '%{http_code}\n' https://capi.vylo-tech.com/updates/darwin/aarch64/<VERSION>
   ```
   The first prints the new version; the second is `204`. A 204 means "you are
   current" — it is the updater's contract, not an error.

## Platforms

`latest.json` carries one entry per `target-arch`. A platform that is absent
answers 204 rather than being handed another platform's binary, so a release
that skipped Windows simply does not offer Windows an update.

Windows artifacts come from CI (they cannot be built on a Mac); download them
from the workflow run, sign them the same way, and add a `windows-x86_64` entry.
