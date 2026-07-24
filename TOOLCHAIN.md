# Toolchain

## Rule: each package owns its dependency graph

Nothing relies on a shared `node_modules`. The Electron adapter, each release channel,
the Capacitor adapter, and the shared host bridge are separate packages with their own
manifests and scripts.

Expected package shape:

| Package | Folder | Purpose |
|---|---|---|
| `@drydock/game` | `game/` | Portable payload package |
| `@drydock/host-bridge` | `packages/host-bridge/` | Typed host API + conformance tests |
| `@drydock/web-iterate-caddy-live` | `platforms/web/iterate/caddy-live/` | Live Caddy-backed browser iteration |
| `@drydock/web-static` | `platforms/web/build/static/` | Static web build adapter |
| `@drydock/channel-vps` | `platforms/web/channels/vps/` | Packaged VPS/Caddy web release |
| `@drydock/desktop-electron` | `platforms/desktop/build/electron/` | Desktop build adapter |
| `@drydock/channel-downloads` | `platforms/desktop/channels/downloads/` | Direct-download testing channel |
| `@drydock/channel-steam` | `platforms/desktop/channels/steam/` | Steam integrate/package/publish tooling |
| `@drydock/channel-epic` | `platforms/desktop/channels/epic/` | Epic integrate/package/publish tooling |
| `@drydock/mobile-capacitor` | `platforms/mobile/build/capacitor/` | Mobile build adapter |
| `@drydock/channel-appstore` | `platforms/mobile/channels/appstore/` | App Store package/publish tooling |
| `@drydock/channel-play` | `platforms/mobile/channels/play/` | Google Play package/publish tooling |

The root should contain `package.json`, `pnpm-workspace.yaml`, `.npmrc`, and
`pnpm-lock.yaml`. Corepack pins the package manager through the root
`packageManager` field.

```sh
corepack enable pnpm
pnpm install
```

Run package scripts with filters:

```sh
pnpm --filter @drydock/web-iterate-caddy-live serve -- --port 8090
pnpm --filter @drydock/web-static build -- --release releases/1.4.0.yaml
pnpm --filter @drydock/channel-vps run publish -- out/web-static/drydock-artifact.json
pnpm --filter @drydock/desktop-electron build -- --platform windows --arch x64
pnpm --filter @drydock/channel-downloads run package -- out/windows-x64/drydock-artifact.json
pnpm --filter @drydock/channel-downloads run publish -- out/downloads
pnpm --filter @drydock/channel-downloads run verify -- --base-url https://vinyltin.duckdns.org/drydock-downloads/
curl -I https://vinyltin.duckdns.org/drydock-downloads/drydock-placeholder-1.4.0-windows-x64.zip
pnpm --filter @drydock/channel-steam integrate -- out/windows-x64/drydock-artifact.json
pnpm --filter @drydock/channel-steam package -- out/windows-x64/drydock-artifact.json
pnpm --filter @drydock/channel-steam run publish -- out/windows-x64/drydock-artifact.json
```

pnpm's content-addressed store keeps installs disk-efficient without merging dependency
graphs.

## Workspace Rules

- The payload can depend on `@drydock/host-bridge`, but not on platform or channel
  packages.
- Iterate packages may serve `game/` directly for fast feedback, but they do not emit
  artifacts, read secrets, or act as release inputs.
- Build adapters can depend on `@drydock/game` and `@drydock/host-bridge`, but not on
  concrete channel packages.
- Channel packages can depend on `@drydock/host-bridge` and consume artifact manifests.
  They should not import private engine adapter internals.
- If a channel implementation must run inside Electron, it must be bundled or copied into
  the Electron app during the channel integration/package stage. Do not rely on runtime
  `require()` resolving across unrelated package `node_modules`.
- Shared helpers belong in a package only when at least two real adapters/channels use
  them. Avoid premature framework code.

## JavaScript Is Not The Whole Toolchain

Native toolchains live beside, not inside, the JS dependency graph.

| Target | Native toolchain(s) |
|---|---|
| Steam / Epic / GOG / itch desktop | electron-builder; channel upload tool such as `steamcmd`, EOS BuildPatchTool, or Butler |
| macOS desktop signing/notarization | Xcode command line tools, Apple notarization credentials |
| App Store | Xcode + CocoaPods + fastlane |
| Google Play | Gradle + Android SDK + fastlane |

An iOS signing problem should not break the Steam pipeline because they do not share a
resolver or secrets file.

Windows code signing is its own toolchain concern. Steam upload tooling does not replace
Authenticode signing, and Steam DRM wrapping should be treated as channel integration
rather than an OS signature. The current direct-download channel can accept unsigned proof
artifacts, but a production download release should sign before packaging and fail closed
when SOPS-injected signing inputs are missing.

## Iteration Tooling

The web iteration path is deliberately lighter than a release:

```sh
pnpm --filter @drydock/web-iterate-caddy-live serve -- --port 8090
```

It should start a localhost-only origin rooted at `game/`, with no-cache headers and no
artifact output. Caddy exposes that origin through a tight allowlist. This is the right
path for fast rendering, controls, layout, and device checks.

Iteration packages must not:

- copy `game/src` into another canonical source tree;
- symlink a second source mirror;
- serve the repo root;
- read SOPS secrets;
- produce `drydock-artifact.json`;
- be used as evidence that a release artifact is reproducible.

## SDKs: Pin, Fetch, Ignore

- Machine-level SDKs such as Xcode, Android SDK/NDK, and platform CLI tools are never
  committed. Pin the required version in the relevant package README or workflow.
- Redistributable SDKs such as Steamworks or EOS are gitignored and fetched by a pinned
  `tools/fetch-sdk-<name>.sh` script against a fixed version.
- Signing keys and channel credentials use SOPS+age. Packagers read environment variables
  only; they do not know how secrets were decrypted.
- The initial Electron proof explicitly denies the transitive `electron-winstaller` build
  script in `pnpm-workspace.yaml`; revisit only when a Windows installer target needs it.

## Build Outputs

Every build adapter writes an artifact root and manifest:

```text
out/<target>/drydock-artifact.json
```

Every integrate/package/publish script accepts a path to that manifest. Scripts should
validate the manifest before doing work and should write updated manifest data or
channel-specific sidecar files when they transform the artifact.

## CI: One Workflow Per Channel

Each release channel has its own workflow, runner requirements, and SOPS age key.

| Workflow | Runner | Builds/releases |
|---|---|---|
| `vps.yml` | linux / target VPS | Static web artifact, Caddy config validation, VPS publish |
| `steam.yml` | windows + macos + linux matrix | Electron per OS, Steam integration/package, upload via steamcmd |
| `epic.yml` | windows + macos matrix | Electron per OS, Epic integration/package, upload via BuildPatchTool |
| `appstore.yml` | macOS only | Capacitor -> Xcode, App Store package/sign/upload via fastlane |
| `play.yml` | linux | Capacitor -> Gradle, Play package/sign/upload via fastlane |

Hard constraints:

- iOS and signed/notarized macOS builds require macOS runners.
- Android can build on Linux.
- Each workflow decrypts only its own `secrets.enc.yaml`.
- Release scripts must avoid `set -x` around secret injection.
