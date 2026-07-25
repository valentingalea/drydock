# Architecture

## Three Ownership Layers

Drydock is organized around three ownership layers that change for different reasons:

```
  GAME / PAYLOAD
    Line Engine runtime + game; portable across shells and channels

  BUILD ADAPTER
    platform shell/compiler; produces a raw artifact and manifest

  RELEASE CHANNEL
    channel-specific integration, package/sign, and publish tooling
```

The payload may depend explicitly on Line Engine, but it must not know which platform
shell or store is active. Runtime libraries such as Line Engine are payload dependencies,
distinct from Drydock build adapters such as web-static and Electron. The channel is
allowed to affect the binary when the store requires it, but that work happens in a
channel-owned stage and is described by explicit contracts.

## Payload Composition

The current payload is Line Engine's canonical `mock-game/`, pinned at `engine/` as a git
submodule. Drydock does not own a second mock. `game/drydock-payload.json` is the source
composition contract: it declares identity, the entrypoint, exact runtime source/target
mappings and the one allowed overlay.

```text
game/drydock-payload.json
  + engine/mock-game/             # canonical mock
  + engine/src, style, lib        # Line Engine runtime + Three.js r160
  + game/host-bridge.js           # Drydock browser bridge
  + game/overlays/platform-host.js
  -> composed runtime tree
```

Line Engine's standalone `mock-game/src/platform-host.js` supplies local browser behavior.
Drydock replaces that module at the same runtime URL with its bridge adapter. No other
Line Engine mock file is transformed or copied into source control. Line Engine remains
usable standalone, while the embedded mock exercises Drydock protocol version 1 and
storage.

The full checkout, update, descriptor, and verification contract is documented in
[`PAYLOAD.md`](./PAYLOAD.md).

## Release Stages

A release moves through four stages:

```
BUILD  ->  INTEGRATE  ->  PACKAGE / SIGN  ->  PUBLISH
```

| Stage | Owner | Purpose | Output |
|---|---|---|---|
| `BUILD` | `platforms/<family>/build/<adapter>/` | Compile, stage, or wrap the payload for an OS/arch. | Raw artifact + `drydock-artifact.json` |
| `INTEGRATE` | `platforms/<family>/channels/<channel>/` | Add channel SDK/runtime behavior such as achievements, overlay, auth, IAP, cloud saves, or entitlement checks. | Integrated artifact or updated manifest |
| `PACKAGE / SIGN` | channel folder, sometimes OS-native project | Produce the store-ready package/depot and apply signing, notarization, entitlements, provisioning, or metadata transforms. | Store-ready package |
| `PUBLISH` | channel folder + CI workflow | Upload/promote using store tooling. | Draft, beta, internal track, private branch, or production candidate |

This replaces the earlier two-stage "build/distribute" simplification. Storefronts do
care about the binary in many real cases: Steam/EOS redistributables, native SDK modules,
macOS notarization, Apple entitlements, Android signing, IAP restore flows, DLC layouts,
and cloud-save providers all cross the old boundary.

The clean boundary is therefore:

- build adapters do not hard-code release channels;
- channel scripts consume the artifact manifest instead of guessing engine paths;
- game code calls the host bridge instead of store SDKs;
- shared contracts change only when a real capability is missing.

## Iteration Loop

Iteration is intentionally outside the release pipeline:

```text
EDIT engine/mock-game or engine/src
  -> descriptor-resolved localhost origin
  -> Caddy allowlist
  -> browser
```

For web payload work, `platforms/web/iterate/caddy-live/` owns the fast feedback path.
It resolves the payload descriptor directly against the live `game/` integration files
and `engine/` submodule so changes appear after refresh. It does not copy source, create
symlink mirrors, emit `drydock-artifact.json`, or publish anything.

The live origin must bind to `127.0.0.1` and expose only descriptor-selected files. Caddy
is the public boundary and mirrors the runtime prefixes under `/engine/`, plus the root
launcher and host bridge. It must deny submodule metadata, docs, tests and package files.

This path optimizes latency. Release channels optimize reproducibility.

## Artifact Manifest

Every build adapter emits a manifest next to its raw output:

```
artifacts/build/<target>/drydock-artifact.json
```

Minimum schema:

```json
{
  "schemaVersion": 1,
  "gameId": "line-engine-calibration",
  "version": "0.1.0",
  "buildNumber": 100,
  "engine": "electron",
  "platform": "windows",
  "arch": "x64",
  "artifactRoot": "win-unpacked",
  "executable": "win-unpacked/line-engine-calibration.exe",
  "bundleId": "dev.drydock.line-engine-calibration",
  "packageId": null,
  "signing": {
    "status": "unsigned"
  },
  "capabilities": [
    "storage"
  ],
  "checksums": [],
  "extensions": {
    "drydock": {
      "buildAdapter": "@drydock/desktop-electron",
      "buildKey": "desktop",
      "payload": "game/drydock-payload.json",
      "entrypoint": "engine/mock-game/index.html",
      "release": "contracts/releases/0.1.0.yaml",
      "engineRevision": {
        "name": "line-engine",
        "path": "engine",
        "release": "v0.0.0",
        "commit": "fb962943c58bb909c3223670a49622c0d6acd39a",
        "remote": "https://github.com/valentingalea/Line-Engine.git",
        "threeRevision": "r160"
      }
    }
  }
}
```

Rules:

- Paths are relative to the manifest unless explicitly absolute.
- Channel tooling reads this manifest first and fails if required fields or capabilities
  are missing.
- The schema-v1 `engine` field identifies the artifact-producing adapter (`electron`,
  `web-static`, or a native engine adapter). The payload runtime pin is recorded
  separately in `extensions.drydock.engineRevision`.
- The schema is versioned. Breaking changes require a schema bump and migration note.
- Build adapters may add adapter-specific extension fields such as
  `extensions.electron`, but channel tooling must not require them unless it explicitly
  supports that adapter.

`contracts/schemas/drydock-artifact.schema.json` and
`tools/scripts/validate-artifact.js` implement this boundary today. Both static web and
Electron also record the exact Line Engine origin and gitlink revision under
`extensions.drydock.engineRevision`.

## Host Bridge

The host bridge is the runtime contract between the payload and its current shell/channel.
The payload imports one typed API and asks what is available.

```ts
const host = await DrydockHost.connect();
const caps = await host.capabilities();

if (caps.achievements) {
  await host.achievements.unlock("first_win");
}

await host.storage.save("slot1", data);
```

Required design points:

- The bridge has a protocol version.
- `capabilities()` reports what the current runtime actually supports.
- Unsupported features return typed `unsupported` results instead of silent no-ops.
- Failures use stable error codes such as `notAuthenticated`, `networkUnavailable`,
  `permissionDenied`, `conflict`, and `unavailableOffline`.
- Purchases include restore and entitlement checks, not only `purchase(sku)`.
- Cloud saves define conflict behavior.
- Every bridge implementation must pass shared conformance tests.

Suggested API shape:

```ts
type HostCapabilities = {
  storage: "local" | "cloud" | "none";
  achievements: boolean;
  telemetry: boolean;
  purchases: boolean;
  identity: boolean;
};

type HostResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string; message?: string };
```

Implementations:

| Runtime/channel | How the bridge is provided |
|---|---|
| Web iterate / itch web | Local implementation using `localStorage` or IndexedDB, with honest capabilities. |
| Electron base shell | `preload.js` exposes only the typed bridge over validated IPC. |
| Steam channel | Supplies Steam achievements, overlay/auth where needed, and cloud-save provider. |
| Epic channel | Supplies EOS-backed capabilities where needed. |
| Capacitor base shell | Bridges to native plugins; App Store / Play channels provide IAP and platform services. |

## Web Composition

Web has both an iteration path and a release path:

```text
platforms/web/iterate/caddy-live/   # live descriptor resolver for immediate feedback
platforms/web/build/static/         # copies runtime files into artifacts/build/web-static/
platforms/web/channels/vps/         # deploys the packaged static artifact to the VPS
```

The static build adapter consumes `game/drydock-payload.json`, copies only its selected
and overlaid runtime files into `artifacts/build/web-static/`, and emits
`drydock-artifact.json`. The manifest records the Line Engine remote, commit and Three.js
revision. The VPS channel consumes that manifest, installs the clean output under a stable
webroot, validates Caddy, reloads it, and performs public allow/deny checks.

The iteration path may serve live source for speed. The VPS channel must deploy a
packaged artifact for reproducibility.

## Desktop Composition

The Electron build adapter creates a store-neutral desktop artifact. A release channel then
integrates and packages it:

```
BUILD:      pnpm --filter @drydock/desktop-electron build -- --platform windows --arch x64
INTEGRATE:  pnpm --filter @drydock/channel-steam integrate artifacts/build/windows-x64/drydock-artifact.json
PACKAGE:    pnpm --filter @drydock/channel-steam package artifacts/build/windows-x64/drydock-artifact.json
PUBLISH:    pnpm --filter @drydock/channel-steam run publish -- artifacts/build/windows-x64/drydock-artifact.json
```

The selected channel may add redistributables, SDK bootstrap code, metadata, depot layout,
or signing configuration. The Electron shell still must not contain Steam/Epic/GOG/itch
branches in its base code.

## Mobile Composition

Mobile has two OS-native bases and two primary release channels:

```
platforms/mobile/build/capacitor/
platforms/mobile/native/ios/
platforms/mobile/native/android/
platforms/mobile/channels/appstore/
platforms/mobile/channels/play/
```

The iOS and Android projects own OS-specific native concerns. App Store and Play own
release-channel concerns: fastlane lanes, store metadata, screenshots, signing input
templates, review-track settings, service-account wiring, and IAP/provider configuration.

Generated native files should be regenerated by Capacitor. Durable customizations should
live either in documented native extension points or channel-owned templates/scripts.

## Electron Security Baseline

Electron releases must start from secure defaults:

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- no remote module
- strict IPC allowlist
- runtime validation for every IPC payload
- secure custom `app://` protocol
- content security policy for the payload
- no arbitrary remote content in production
- no direct store SDK access from renderer code

The preload exposes only the typed host bridge.

## Payload Runtimes And Build Adapters

Line Engine is the runtime dependency of the current payload. Static web, Electron, and
future Capacitor packages are build adapters/shells that can all consume the same
descriptor-selected browser runtime:

- **Web games** use `platforms/web/iterate/caddy-live/` for fast browser iteration,
  `platforms/web/build/static/` + `platforms/web/channels/vps/` for public web releases,
  Electron for desktop, and Capacitor for mobile.
- **Native-engine games**, such as Unreal payloads, need a separate build adapter around
  their compiler/cooker while still emitting the same artifact manifest and implementing
  the host bridge.
- **A future browser runtime** may replace Line Engine by changing the payload descriptor
  and pinning its source explicitly, without changing channel tooling that consumes only
  the resulting manifest.

Store SDK integration may live in an engine plugin when the engine requires it
(`OnlineSubsystemSteam`, EOS plugins, native mobile plugins). That is still channel-owned
integration work; it should be configured by the channel and reported through the manifest
and host bridge.

## Console Position

The architecture should not block console support, but console support is a private
extension until a real console adapter, SDK access, devkit workflow, certification process,
and channel-specific package/sign/publish flow exist. Do not describe consoles as a simple
folder addition.
