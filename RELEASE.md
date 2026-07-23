# Release

Mental model: one-time setup per release channel, then a repeatable four-stage flow:

```text
BUILD -> INTEGRATE -> PACKAGE / SIGN -> PUBLISH
```

The commands below assume channel accounts, SDK access, signing setup, and SOPS files are
already configured.

## Build/Host OS Matrix

| Target | Can build on |
|---|---|
| Steam / Epic / GOG / itch Windows + Linux binaries | Any OS if the engine/toolchain supports cross-build |
| Steam / Epic / GOG / itch macOS binary, signed/notarized | macOS only |
| App Store | macOS only |
| Google Play | Linux, macOS, or Windows; Linux preferred in CI |

## Versioning: Release Manifest

Do not rely on one scalar version to cover every store. Use one release manifest per
candidate:

```yaml
version: 1.4.0
build:
  steam: 10400
  epic: 10400
  appstore: 87
  play: 1040087
channels:
  steam:
    branch: beta
  epic:
    sandbox: stage
  appstore:
    submitForReview: false
  play:
    track: internal
```

The shared `version` is the marketing version. Per-channel build numbers stay monotonic
according to each platform's rules. A future `pnpm run bump` should update this manifest
and generate platform-specific manifest changes from it.

## Shared Prep

```sh
corepack enable pnpm
pnpm install
pnpm run vendor
pnpm run release:prepare -- releases/1.4.0.yaml
```

`release:prepare` should eventually validate:

- release manifest shape;
- artifact schema availability;
- no CDN/runtime dependency leakage;
- required SOPS files and `secrets.example` contracts;
- channel workflow names and tag patterns.

## Desktop Example: Steam

One-time setup:

- Steamworks partner account and least-privilege builder account.
- AppID and depot IDs committed in `platforms/desktop/channels/steam/metadata/`.
- Steamworks SDK fetch script pinned to an exact version.
- `steamcmd` available in CI.
- `platforms/desktop/channels/steam/secrets.enc.yaml` populated with builder credentials
  and Steam Guard solution.

Per release:

```sh
# BUILD: raw Electron artifact + drydock-artifact.json.
pnpm --filter @drydock/desktop-electron build -- \
  --platform win32 \
  --arch x64 \
  --release releases/1.4.0.yaml

# INTEGRATE: Steam SDK/runtime provider/depot inputs.
pnpm --filter @drydock/channel-steam integrate -- \
  out/win32-x64/drydock-artifact.json

# PACKAGE / SIGN: produce the Steam-ready depot layout.
pnpm --filter @drydock/channel-steam package -- \
  out/win32-x64/drydock-artifact.json

# PUBLISH: decrypt only Steam secrets and upload.
sops exec-env platforms/desktop/channels/steam/secrets.enc.yaml \
  'pnpm --filter @drydock/channel-steam publish -- out/win32-x64/drydock-artifact.json'
```

Final step is manual: set the uploaded build live on its Steam branch in the Steamworks
dashboard. First release also needs store page completion and Valve content review.

## Mobile Example: App Store

One-time setup:

- Apple Developer Program membership.
- App record in App Store Connect.
- Native iOS project generated under `platforms/mobile/native/ios`.
- fastlane `match` configured for signing.
- App Store channel SOPS file populated with App Store Connect API key fields,
  `MATCH_PASSWORD`, and related lane secrets.

Per release:

```sh
# BUILD: sync payload into the native iOS project and emit artifact manifest.
pnpm --filter @drydock/mobile-capacitor build:ios -- \
  --release releases/1.4.0.yaml

# PACKAGE / SIGN + PUBLISH through the App Store channel.
sops exec-env platforms/mobile/channels/appstore/secrets.enc.yaml \
  'pnpm --filter @drydock/channel-appstore publish -- out/ios/drydock-artifact.json'
```

The App Store channel lane should archive/sign the `.ipa`, upload to App Store Connect,
and optionally submit for review based on the release manifest. Internal TestFlight builds
should be the fast smoke-test path.

## Mobile Example: Google Play

One-time setup:

- Play Console account and app record.
- Upload keystore enrolled in Play App Signing.
- Google Cloud service-account JSON encrypted in
  `platforms/mobile/channels/play/secrets.enc.yaml`.
- Native Android project generated under `platforms/mobile/native/android`.

Per release:

```sh
# BUILD: sync payload into the native Android project and emit artifact manifest.
pnpm --filter @drydock/mobile-capacitor build:android -- \
  --release releases/1.4.0.yaml

# PACKAGE / SIGN + PUBLISH through the Play channel.
sops exec-env platforms/mobile/channels/play/secrets.enc.yaml \
  'pnpm --filter @drydock/channel-play publish -- out/android/drydock-artifact.json'
```

The Play channel lane should build a signed `.aab` and upload to the track selected by the
release manifest. Promotion from internal/closed tracks to production may remain manual.

## CI-Driven Release

Releases should be tag-triggered or workflow-dispatched per channel. Each workflow:

1. Checks out the repo.
2. Enables Corepack and installs dependencies.
3. Validates the release manifest.
4. Builds the target artifact and validates `drydock-artifact.json`.
5. Runs channel integration/package scripts.
6. Decrypts only that channel's SOPS file.
7. Publishes to a private branch, beta track, internal track, draft release, or equivalent.

Example tags:

```sh
git tag steam-v1.4.0
git tag appstore-v1.4.0
git tag play-v1.4.0
git push origin steam-v1.4.0 appstore-v1.4.0 play-v1.4.0
```

The remaining manual step is the store dashboard action that legally publishes or submits
the release, unless the release manifest explicitly opts into automatic submission.

## Unreal Note

For an Unreal payload, the build stage changes to a `build/unreal` adapter around
`RunUAT BuildCookRun`. Channel work may configure Unreal store plugins, but channel
scripts still consume the artifact manifest and publish through the same channel-owned
flow.
