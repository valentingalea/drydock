# Release

Mental model: one-time setup per release channel, then a repeatable four-stage flow:

```text
BUILD -> INTEGRATE -> PACKAGE / SIGN -> PUBLISH
```

The commands below assume channel accounts, SDK access, signing setup, and SOPS files are
already configured.

## Iteration Is Separate

The fast web path is not a release. `platforms/web/iterate/caddy-live/` resolves the live
Line Engine mock and Drydock host overlay through a localhost-bound origin and Caddy
allowlist so browser refreshes reflect source edits immediately.

Use it for feel, rendering, controls, and device smoke checks:

```sh
pnpm --filter @drydock/web-iterate-caddy-live serve -- --port 8090
```

Do not promote, archive, or compare that live origin as a release. The release path for
the VPS is `platforms/web/build/static/` plus `platforms/web/channels/vps/`.

## Build/Host OS Matrix

| Target | Can build on |
|---|---|
| VPS web static artifact | Any OS |
| VPS publish through Caddy/systemd | Target VPS or a runner with SSH/deploy access |
| Steam / Epic / GOG / itch Windows + Linux binaries | Any OS if the engine/toolchain supports cross-build |
| Steam / Epic / GOG / itch macOS binary, signed/notarized | macOS only |
| App Store | macOS only |
| Google Play | Linux, macOS, or Windows; Linux preferred in CI |

## Versioning: Release Manifest

Do not rely on one scalar version to cover every store. Use one release manifest per
candidate:

```yaml
version: 0.1.0
build:
  desktop: 100
  vps: 100
  steam: 100
  epic: 100
  appstore: 1
  play: 100
channels:
  vps:
    host: drydock.example.com
    root: /var/www/drydock
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
git submodule update --init --recursive
corepack enable pnpm
pnpm install
pnpm run vendor
pnpm run validate:submodule
pnpm run release:prepare -- contracts/releases/0.1.0.yaml
```

`release:prepare` should eventually validate:

- release manifest shape;
- artifact schema availability;
- no CDN/runtime dependency leakage;
- required SOPS files and `secrets.example` contracts;
- channel workflow names and tag patterns.

## Web Example: VPS / Caddy

One-time setup:

- Public domain or subdomain points at the VPS.
- Caddy is installed, enabled, and serving TLS.
- The live iteration origin, if enabled, serves only descriptor-selected payload files
  from `127.0.0.1`.
- The release channel has a stable deploy root such as `/var/www/drydock`.
- Caddy config is generated or templated from `platforms/web/channels/vps/caddy.example`.

Per release:

```sh
# BUILD: compose the pinned Line Engine mock + Drydock host adapter and emit a manifest.
pnpm --filter @drydock/web-static build -- \
  --release contracts/releases/0.1.0.yaml

# PACKAGE / PUBLISH: install clean static output and reload Caddy.
pnpm --filter @drydock/channel-vps run publish -- \
  artifacts/build/web-static/drydock-artifact.json

# VERIFY: confirm public runtime paths load and repo/internal paths are denied.
pnpm --filter @drydock/channel-vps run verify -- \
  --live-url https://vinyltin.duckdns.org/drydock/ \
  --release-url https://vinyltin.duckdns.org/drydock-release/
```

The VPS channel must deploy the packaged `artifacts/build/web-static/` output, not the repo root and
not the live iteration origin. It should validate the Caddy config before reload and run
public checks for allowed runtime paths and denied repo paths.

When Caddy config changes, validate before reload:

```sh
sudo caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Use Playwright for render-level smoke after route checks:

```sh
pnpm smoke:web -- https://vinyltin.duckdns.org/drydock/
pnpm smoke:web -- https://vinyltin.duckdns.org/drydock-release/
```

Current proof-of-concept routes on this VPS:

- Live iteration: `https://vinyltin.duckdns.org/drydock/` -> `127.0.0.1:8090`
- Packaged release artifact: `https://vinyltin.duckdns.org/drydock-release/` ->
  `/var/www/drydock`

## Desktop Example: Direct Downloads

Direct downloads are a testing channel for Electron artifacts. They are useful before a
real store channel exists, but they do not replace Steam/Epic/GOG/itch package/sign/publish
stages.

Current proof package:

- `https://vinyltin.duckdns.org/drydock-downloads/line-engine-calibration-0.1.0-windows-x64.zip`
- `https://vinyltin.duckdns.org/drydock-downloads/line-engine-calibration-0.1.0-windows-x64.zip.sha256`

Build the Windows x64 artifact:

```sh
pnpm --filter @drydock/desktop-electron build -- \
  --release contracts/releases/0.1.0.yaml \
  --platform windows \
  --arch x64

pnpm --filter @drydock/channel-downloads run package -- \
  artifacts/build/windows-x64/drydock-artifact.json

pnpm --filter @drydock/channel-downloads run publish -- \
  artifacts/channels/downloads

pnpm --filter @drydock/channel-downloads run verify -- \
  --base-url https://vinyltin.duckdns.org/drydock-downloads/
```

The current VPS route serves only the package archive, checksum, and index page from
`/var/www/drydock-downloads`.

Windows signing can be added before the download package step. The signing input is either
an Authenticode code-signing certificate usable by electron-builder, Azure Trusted
Signing credentials, or a Linux-compatible signing tool such as `osslsigncode` with a PFX
and timestamp server. Signing secrets must be injected from
`platforms/desktop/channels/downloads/secrets.enc.yaml` through SOPS+age.

Windows signing is independent of Steam. Steam does not give this project a general
Windows Authenticode signature for direct downloads. Steam can provide Steam-specific
release mechanics such as depots, install scripts, and optional DRM wrapping, but those
do not replace OS-level code signing. For private Steam branch testing, unsigned Windows
builds are acceptable until the project chooses a stricter policy. For production direct
downloads, require signing before packaging so missing credentials fail the release
instead of producing an unsigned public archive.

## Desktop Example: Steam

One-time setup:

- Electron base dependencies are installed through `platforms/desktop/build/electron/`.
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
  --platform windows \
  --arch x64 \
  --release contracts/releases/0.1.0.yaml

# INTEGRATE: Steam SDK/runtime provider/depot inputs.
pnpm --filter @drydock/channel-steam integrate -- \
  artifacts/build/windows-x64/drydock-artifact.json

# PACKAGE / SIGN: produce the Steam-ready depot layout.
pnpm --filter @drydock/channel-steam package -- \
  artifacts/build/windows-x64/drydock-artifact.json

# PUBLISH: decrypt only Steam secrets and upload.
sops exec-env platforms/desktop/channels/steam/secrets.enc.yaml \
  'pnpm --filter @drydock/channel-steam run publish -- artifacts/build/windows-x64/drydock-artifact.json'
```

Final step is manual: set the uploaded build live on its Steam branch in the Steamworks
dashboard. First release also needs store page completion and Valve content review.

Steam packaging and Windows code signing are separate decisions. The Steam channel can
upload an unsigned Windows depot for early/private branch testing, but Steam does not sign
the executable for use outside Steam. If the same binary will also ship through direct
downloads, itch, GOG, or another non-Steam Windows channel, sign it before the channel
package/depot step with SOPS-injected signing inputs. If Steam DRM wrapping is used, treat
it as Steam integration, not as a signing substitute.

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
  --release contracts/releases/0.1.0.yaml

# PACKAGE / SIGN + PUBLISH through the App Store channel.
sops exec-env platforms/mobile/channels/appstore/secrets.enc.yaml \
  'pnpm --filter @drydock/channel-appstore run publish -- artifacts/build/ios/drydock-artifact.json'
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
  --release contracts/releases/0.1.0.yaml

# PACKAGE / SIGN + PUBLISH through the Play channel.
sops exec-env platforms/mobile/channels/play/secrets.enc.yaml \
  'pnpm --filter @drydock/channel-play run publish -- artifacts/build/android/drydock-artifact.json'
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
git tag steam-v0.1.0
git tag appstore-v0.1.0
git tag play-v0.1.0
git push origin steam-v0.1.0 appstore-v0.1.0 play-v0.1.0
```

The remaining manual step is the store dashboard action that legally publishes or submits
the release, unless the release manifest explicitly opts into automatic submission.

## Unreal Note

For an Unreal payload, the build stage changes to a `build/unreal` adapter around
`RunUAT BuildCookRun`. Channel work may configure Unreal store plugins, but channel
scripts still consume the artifact manifest and publish through the same channel-owned
flow.
