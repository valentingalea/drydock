# Roadmap

Status: **product/release separation proven across web and Electron**. The complete proof
product is pinned at `product/` and owns its contract and host adapter. Live iteration
reads that checkout by default and may optionally select another checkout, while packaged
static web and Electron strictly consume the pinned product and emit artifact-schema-v2
manifests. Store channels, signing, and mobile remain unbuilt.

## Build Order

Do these in sequence. Each step should leave something executable or enforceable behind.

### 1. Shared Contracts

- [x] `contracts/host-bridge/` defines the typed host API, protocol version, capability
      model, error codes, and conformance tests.
- [x] `contracts/schemas/drydock-artifact.schema.json` defines the artifact manifest contract.
- [x] `contracts/schemas/drydock-product.schema.json` defines the product-owned
      composition contract.
- [x] `tools/scripts/validate-artifact.js` validates `drydock-artifact.json`.
- [x] Root `package.json`, `pnpm-workspace.yaml`, `.npmrc`, and lockfile exist.

### 2. Product Contract + Web Iterate

- [x] The complete proof product is pinned as the root `product/` git submodule.
- [x] `product/drydock-product.json` owns identity, entrypoint, runtime mappings, and the
      product-side host adapter.
- [x] Drydock owns only the generic `runtime/web/` host implementation.
- [x] `game/` and Drydock's product-specific overlay were removed.
- [x] Live iteration reads `product/` by default; `DRYDOCK_PRODUCT_ROOT` remains an
      optional override.
- [x] Release builds ignore that override and strictly verify the pinned product gitlink.
- [x] Caddy exposes only the composed runtime and denies product metadata/docs/tests.
- [x] `docs/PRODUCT.md` defines product substitution, iteration, pinning, and verification.

### 3. Web Static Build + VPS Channel

- [x] `platforms/web/build/static/` stages only contract-selected runtime files into
      `artifacts/build/web-static/`.
- [x] Artifact schema v2 separates `productId` from `buildAdapter` and records the product
      contract, origin, tag, and commit.
- [x] The static build emits and validates `artifacts/build/web-static/drydock-artifact.json`.
- [x] `platforms/web/channels/vps/` deploys the packaged `artifacts/build/web-static/` artifact, not
      the live iterate origin.
- [x] VPS channel config validates Caddy before reload and runs public allow/deny checks.
- [x] The release manifest includes the `vps` channel.

### 3.5. VPS Platform Hardening

- [x] The live iterate origin has a repo-owned systemd service template.
- [x] `platforms/web/channels/vps/` has a repeatable public verifier for live and release
      routes.
- [x] VPS docs distinguish repository-owned templates from configurable external deploy
      state without recording an individual machine's layout.
- [x] Render-level Playwright smoke checks remain separate from HTTP allow/deny checks.

### 4. Desktop Build Adapter: Electron

- [x] `platforms/desktop/build/electron/` exists with `main.js`, `preload.js`,
      `builder.base.yml`, and `package.json`.
- [x] Register a secure `app://` protocol serving the composed product runtime.
- [x] Enforce Electron security defaults: context isolation, no node integration,
      sandboxed renderer, strict IPC allowlist, CSP.
- [x] `preload.js` exposes only the typed host bridge over validated IPC.
- [x] Produce an unpacked build.
- [x] Emit and validate `artifacts/build/<target>/drydock-artifact.json`.

### 4.5. Direct Download Test Packages

- [x] A Windows x64 Electron artifact can be built on the VPS for manual testing.
- [x] A Caddy route exposes only packaged archives, checksums, and an index page under
      `/drydock-downloads/`.
- [x] The downloads channel consumes `drydock-artifact.json`, packages a zip/checksum,
      publishes the webroot, and verifies public allow/deny behavior.
- [x] The current proof package is
      `line-engine-calibration-0.1.0-windows-x64.zip`.
- [ ] Windows code signing is wired through SOPS-provided signing inputs.

### 5. First Desktop Store Channel: Steam

- [ ] `platforms/desktop/channels/steam/` exists with `integrate.sh`, `package.sh`,
      `publish.sh`, `host.js`, metadata, assets, and `package.json`.
- [ ] `secrets.example`, `secrets.enc.yaml`, and `.sops.yaml` are configured for Steam.
- [ ] Steam integration consumes only `drydock-artifact.json` plus documented channel
      metadata.
- [ ] Steam host provider passes host-bridge conformance tests for its claimed
      capabilities.
- [ ] `publish.sh` uploads via `steamcmd` using env vars injected by SOPS.
- [ ] `.github/workflows/steam.yml` builds win/linux/mac where appropriate and decrypts
      only Steam secrets.
- [ ] Prove tag/workflow -> private Steam branch upload.

### 6. Release Manifest

- [x] `contracts/schemas/release-manifest.schema.json` exists.
- [x] `contracts/releases/<version>.yaml` example exists.
- [x] Shared marketing version and per-channel build numbers are represented.
- [x] Static web and Electron build scripts consume the release manifest; channel
      packagers consume the resulting artifact manifest.
- [ ] Platform manifests are generated from the release manifest where needed.

### 7. Mobile: Capacitor + App Store / Play Channels

- [ ] `platforms/mobile/build/capacitor/` emits iOS and Android artifact manifests.
- [ ] `platforms/mobile/native/ios/` and `platforms/mobile/native/android/` are generated
      and reproducible.
- [ ] `platforms/mobile/channels/appstore/` owns fastlane lanes, metadata, assets,
      package/publish scripts, and SOPS secrets.
- [ ] `platforms/mobile/channels/play/` owns fastlane lanes, metadata, assets,
      package/publish scripts, and SOPS secrets.
- [ ] `.github/workflows/appstore.yml` runs on macOS and decrypts only App Store secrets.
- [ ] `.github/workflows/play.yml` runs on Linux and decrypts only Play secrets.

### 8. Second Desktop Store Channel: Epic

- [ ] `platforms/desktop/channels/epic/` proves the channel pattern generalizes.
- [ ] Epic adds channel folder + workflow without changing product code.
- [ ] Any required shared contract changes are documented as artifact/host schema
      improvements, not ad hoc engine path access.

### 9. Native Engine Build Adapter: Unreal

- [ ] `platforms/desktop/build/unreal/` wraps `RunUAT BuildCookRun`.
- [ ] Unreal emits the same artifact manifest schema.
- [ ] Channel-owned Unreal plugin configuration is explicit.
- [ ] At least one existing desktop channel can package/publish an Unreal artifact through
      the same manifest-first flow.

## Definition Of Done For The Template

- Live Caddy-backed iteration reads `product/` without duplicate source or
  repository-root exposure; an external checkout is optional.
- A product change is committed and pushed in its own repository before Drydock records
  the reachable revision as a separate gitlink commit.
- One release manifest plus channel tags can produce uploads to the VPS web channel,
  Steam, App Store, and Play.
- Every build adapter emits a valid `drydock-artifact.json`.
- Every host bridge implementation passes shared conformance tests for its claimed
  capabilities.
- SOPS+age is the only documented secret storage path for channel credentials.
- Adding a channel primarily adds one `channels/<channel>/` folder and one workflow.
- Swapping the complete product or build adapter does not require product code to know
  about a store/channel.
- Console support is described only as a future/private extension until a real adapter and
  certification workflow exist.
