# Architecture

## Three Ownership Layers

Drydock is organized around three ownership layers that change for different reasons:

```
  PRODUCT / VESSEL
    complete game repository; owns its engine and Drydock product contract

  BUILD ADAPTER
    platform shell/compiler; produces a raw artifact and manifest

  RELEASE CHANNEL
    channel-specific integration, package/sign, and publish tooling
```

The product owns whatever engine or runtime it uses, but it must not know which release
channel or store is active. Drydock build adapters such as web-static and Electron
consume the product contract without inspecting those internals. A channel may affect the
binary when a store requires it, but that work happens in a channel-owned stage.

## Product Composition

The complete product repository is pinned at `product/`. It owns a root
`drydock-product.json` contract containing identity, entrypoint, and exact
product-relative source/runtime-target mappings. Drydock contributes only its generic
host runtime.

```text
product/drydock-product.json
  + product-selected sources
  + product-owned Drydock adapter
  + runtime/web/host-bridge.js
  + runtime/web/vendor/
  -> composed runtime tree
```

Today the product repository is Line Engine and the proof entrypoint is its calibration
client. Line Engine's contract selects its own `integrations/drydock/platform-host.js`
adapter. A future full game owns Line Engine internally; Drydock sees only that game's
product contract and revision.

The full checkout, iteration, pinning, and substitution contract is documented in
[`PRODUCT.md`](./PRODUCT.md).

## Release Stages

A release moves through four stages:

```
BUILD  ->  INTEGRATE  ->  PACKAGE / SIGN  ->  PUBLISH
```

| Stage | Owner | Purpose | Output |
|---|---|---|---|
| `BUILD` | `platforms/<family>/build/<adapter>/` | Compile, stage, or wrap the product for an OS/arch. | Raw artifact + `drydock-artifact.json` |
| `INTEGRATE` | `platforms/<family>/channels/<channel>/` | Add channel SDK/runtime behavior such as achievements, overlay, auth, IAP, cloud saves, or entitlement checks. | Integrated artifact or updated manifest |
| `PACKAGE / SIGN` | channel folder, sometimes OS-native project | Produce the store-ready package/depot and apply signing, notarization, entitlements, provisioning, or metadata transforms. | Store-ready package |
| `PUBLISH` | channel folder + CI workflow | Upload/promote using store tooling. | Draft, beta, internal track, private branch, or production candidate |

This replaces the earlier two-stage "build/distribute" simplification. Storefronts do
care about the binary in many real cases: Steam/EOS redistributables, native SDK modules,
macOS notarization, Apple entitlements, Android signing, IAP restore flows, DLC layouts,
and cloud-save providers all cross the old boundary.

The clean boundary is therefore:

- build adapters do not hard-code release channels;
- channel scripts consume the artifact manifest instead of inspecting product paths;
- product code calls the host bridge instead of store SDKs;
- shared contracts change only when a real capability is missing.

## Iteration Loop

Iteration is intentionally outside the release pipeline:

```text
EDIT standalone product checkout
  -> product-contract-resolved localhost origin
  -> Caddy allowlist
  -> browser
```

For web product work, `platforms/web/iterate/caddy-live/` owns the fast feedback path.
It resolves `drydock-product.json` against `DRYDOCK_PRODUCT_ROOT`, or the pinned
`product/` checkout when no override is set. Changes appear after refresh without a
copy, symlink mirror, artifact, or publish step.

The live origin binds to `127.0.0.1` and exposes only contract-selected files. Caddy is
the public boundary and allows the `/product/` runtime prefix plus the root launcher and
host bridge. Product metadata, docs, tests and package files remain unavailable.

This path optimizes latency. Release channels optimize reproducibility.

## Artifact Manifest

Every build adapter emits a manifest next to its raw output:

```
artifacts/build/<target>/drydock-artifact.json
```

Minimum schema:

```json
{
  "schemaVersion": 2,
  "productId": "line-engine-calibration",
  "version": "0.1.0",
  "buildNumber": 100,
  "buildAdapter": "electron",
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
      "adapterPackage": "@drydock/desktop-electron",
      "buildKey": "desktop",
      "productContract": "product/drydock-product.json",
      "entrypoint": "product/mock-game/index.html",
      "release": "contracts/releases/0.1.0.yaml",
      "productRevision": {
        "path": "product",
        "contract": "product/drydock-product.json",
        "commit": "52e9ec6a8feb51200a268754a8f08d8777a0992e",
        "remote": "https://github.com/valentingalea/Line-Engine.git",
        "tag": "v0.0.1"
      }
    }
  }
}
```

Rules:

- Paths are relative to the manifest unless explicitly absolute.
- Channel tooling reads this manifest first and fails if required fields or capabilities
  are missing.
- Schema v2 separates `productId` from `buildAdapter`; Electron is an adapter, not an
  engine identity.
- The schema is versioned. Breaking changes require a schema bump and migration note.
- Build adapters may add adapter-specific extension fields such as
  `extensions.electron`, but channel tooling must not require them unless it explicitly
  supports that adapter.

`contracts/schemas/drydock-artifact.schema.json` and
`tools/scripts/validate-artifact.js` implement this boundary today. Both static web and
Electron record the exact product origin, contract, tag, and gitlink revision under
`extensions.drydock.productRevision`.

## Host Bridge

The host bridge is the runtime contract between the product and its current
shell/channel. The product imports one typed API and asks what is available.

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

The static build adapter consumes `product/drydock-product.json`, stages only selected
product files plus the Drydock host runtime into `artifacts/build/web-static/`, and emits
`drydock-artifact.json`. The manifest records the product contract and revision. The VPS
channel consumes that manifest, installs the clean output under a stable webroot,
validates Caddy, reloads it, and performs public allow/deny checks.

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
- content security policy for the composed product runtime
- no arbitrary remote content in production
- no direct store SDK access from renderer code

The preload exposes only the typed host bridge.

## Product Runtimes And Build Adapters

Static web, Electron, and future Capacitor packages are build adapters/shells that can
consume the same contract-selected browser product:

- **Web games** use `platforms/web/iterate/caddy-live/` for fast browser iteration,
  `platforms/web/build/static/` + `platforms/web/channels/vps/` for public web releases,
  Electron for desktop, and Capacitor for mobile.
- **Native-engine games**, such as Unreal products, need a separate build adapter around
  their compiler/cooker while still emitting the same artifact manifest and implementing
  the host bridge.
- **A future full game** replaces the `product/` gitlink and supplies the same product and
  host contracts. Its internal Line Engine dependency is immaterial to Drydock.

Store SDK integration may live in an engine plugin when the engine requires it
(`OnlineSubsystemSteam`, EOS plugins, native mobile plugins). That is still channel-owned
integration work; it should be configured by the channel and reported through the manifest
and host bridge.

## Console Position

The architecture should not block console support, but console support is a private
extension until a real console adapter, SDK access, devkit workflow, certification process,
and channel-specific package/sign/publish flow exist. Do not describe consoles as a simple
folder addition.
