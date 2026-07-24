# Architecture

## Three Ownership Layers

Drydock is organized around three ownership layers that change for different reasons:

```
  GAME / PAYLOAD
    portable game code; calls the host bridge only

  BUILD ADAPTER
    engine-specific; produces a raw native artifact and manifest

  RELEASE CHANNEL
    channel-specific integration, package/sign, and publish tooling
```

The payload must not know which engine shell or store is active. The channel is allowed to
affect the binary when the store requires it, but that work happens in a channel-owned
stage and is described by explicit contracts.

## Release Stages

A release moves through four stages:

```
BUILD  ->  INTEGRATE  ->  PACKAGE / SIGN  ->  PUBLISH
```

| Stage | Owner | Purpose | Output |
|---|---|---|---|
| `BUILD` | `platforms/<family>/build/<engine>/` | Compile or wrap the payload for an OS/arch. | Raw artifact + `drydock-artifact.json` |
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
EDIT game/  ->  localhost origin rooted at game/  ->  Caddy allowlist  ->  browser
```

For web payload work, `platforms/web/iterate/caddy-live/` owns the fast feedback path.
It serves the live `game/` tree directly so changes to HTML, JS, shaders, assets, and
styling appear on the public Caddy URL after a browser refresh. It does not copy source,
does not create symlink mirrors, does not emit `drydock-artifact.json`, and does not
publish anything.

The live origin must bind to `127.0.0.1` and use `game/` as its document root. Caddy is
the public boundary and must allowlist only runtime paths such as `/`, `/index.html`,
`/host-bridge.js`, `/src/*`, `/assets/*`, and `/vendor/*`.

This path optimizes latency. Release channels optimize reproducibility.

## Artifact Manifest

Every build adapter emits a manifest next to its raw output:

```
out/<target>/drydock-artifact.json
```

Minimum schema:

```json
{
  "schemaVersion": 1,
  "gameId": "example",
  "version": "1.4.0",
  "buildNumber": 42,
  "engine": "electron",
  "platform": "windows",
  "arch": "x64",
  "artifactRoot": "out/windows-x64",
  "executable": "Example.exe",
  "bundleId": null,
  "packageId": null,
  "signing": {
    "status": "unsigned"
  },
  "capabilities": [
    "achievements",
    "cloudSave"
  ],
  "checksums": []
}
```

Rules:

- Paths are relative to the manifest unless explicitly absolute.
- Channel tooling reads this manifest first and fails if required fields or capabilities
  are missing.
- The schema is versioned. Breaking changes require a schema bump and migration note.
- Build adapters may add engine-specific extension fields under `extensions.<engine>`, but
  channel tooling must not require them unless it explicitly supports that engine.

The first implementation should also add a JSON Schema file and a validation command so
CI can reject malformed artifacts before upload.

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
platforms/web/iterate/caddy-live/   # live game/ origin for immediate feedback
platforms/web/build/static/         # copies runtime files into out/web-static/
platforms/web/channels/vps/         # deploys the packaged static artifact to the VPS
```

The static build adapter consumes `game/`, copies only runtime files into
`out/web-static/`, and emits `drydock-artifact.json`. The VPS channel consumes that
manifest, installs the clean output under a stable webroot or localhost origin root,
validates the Caddy config, reloads Caddy, and performs public allow/deny checks.

The iteration path may serve live source for speed. The VPS channel must deploy a
packaged artifact for reproducibility.

## Desktop Composition

The Electron build adapter creates a store-neutral desktop artifact. A release channel then
integrates and packages it:

```
BUILD:      pnpm --filter @drydock/desktop-electron build -- --platform windows --arch x64
INTEGRATE:  pnpm --filter @drydock/channel-steam integrate out/windows-x64/drydock-artifact.json
PACKAGE:    pnpm --filter @drydock/channel-steam package out/windows-x64/drydock-artifact.json
PUBLISH:    pnpm --filter @drydock/channel-steam run publish -- out/windows-x64/drydock-artifact.json
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

## Engine Adapters

Engine changes replace build adapters, not the payload or channel contracts:

- **Web games** use `platforms/web/iterate/caddy-live/` for fast browser iteration,
  `platforms/web/build/static/` + `platforms/web/channels/vps/` for public web releases,
  Electron for desktop, and Capacitor for mobile.
- **Unreal games** use a `build/unreal` adapter around `RunUAT BuildCookRun`.
- **Other engines** can be added if they emit the artifact manifest and implement the host
  bridge.

Store SDK integration may live in an engine plugin when the engine requires it
(`OnlineSubsystemSteam`, EOS plugins, native mobile plugins). That is still channel-owned
integration work; it should be configured by the channel and reported through the manifest
and host bridge.

## Console Position

The architecture should not block console support, but console support is a private
extension until a real console adapter, SDK access, devkit workflow, certification process,
and channel-specific package/sign/publish flow exist. Do not describe consoles as a simple
folder addition.
