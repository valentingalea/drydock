# Roadmap

Status: **proof-of-concept scaffold with web and Electron build slices**. The VPS web
path can iterate live and publish a packaged static artifact; the Electron adapter can
produce an unpacked desktop artifact. Store channels and mobile remain unbuilt.

## Build Order

Do these in sequence. Each step should leave something executable or enforceable behind.

### 1. Shared Contracts

- [x] `packages/host-bridge/` defines the typed host API, protocol version, capability
      model, error codes, and conformance tests.
- [x] `schemas/drydock-artifact.schema.json` defines the artifact manifest contract.
- [x] `tools/validate-artifact.js` validates `drydock-artifact.json`.
- [x] Root `package.json`, `pnpm-workspace.yaml`, `.npmrc`, and lockfile exist.

### 2. Payload + Web Iterate

- [x] `game/index.html` renders a minimal WebGL scene.
- [x] Runtime dependencies are vendored locally; no CDN references.
- [x] `game/host-bridge.js` uses the shared bridge contract with honest web/dev
      capabilities.
- [x] `platforms/web/iterate/caddy-live/` serves `game/` directly as the document root.
- [x] The live origin binds to `127.0.0.1`, sends no-cache headers, and never serves the
      repo root.
- [x] Caddy allowlist exposes only runtime paths such as `/`, `/index.html`,
      `/host-bridge.js`, `/src/*`, `/assets/*`, and `/vendor/*`.
- [x] Public browser refresh reflects edits to `game/` without a build or deploy step.

### 3. Web Static Build + VPS Channel

- [x] `platforms/web/build/static/` copies only runtime files from `game/` into
      `out/web-static/`.
- [x] The static build emits and validates `out/web-static/drydock-artifact.json`.
- [x] `platforms/web/channels/vps/` deploys the packaged `out/web-static/` artifact, not
      the live iterate origin.
- [x] VPS channel config validates Caddy before reload and runs public allow/deny checks.
- [x] The release manifest includes the `vps` channel.

### 3.5. VPS Platform Hardening

- [x] The live iterate origin has a repo-owned systemd service template.
- [x] `platforms/web/channels/vps/` has a repeatable public verifier for live and release
      routes.
- [x] VPS docs identify external deploy state under `/etc/caddy`, `/var/www/drydock`,
      and the live localhost origin.
- [x] Render-level Playwright smoke checks remain separate from HTTP allow/deny checks.

### 4. Desktop Build Adapter: Electron

- [x] `platforms/desktop/build/electron/` exists with `main.js`, `preload.js`,
      `builder.base.yml`, and `package.json`.
- [x] Register a secure `app://` protocol serving `game/`.
- [x] Enforce Electron security defaults: context isolation, no node integration,
      sandboxed renderer, strict IPC allowlist, CSP.
- [x] `preload.js` exposes only the typed host bridge over validated IPC.
- [x] Produce an unpacked build.
- [x] Emit and validate `out/<target>/drydock-artifact.json`.

### 4.5. Direct Download Test Packages

- [x] A Windows x64 Electron artifact can be built on the VPS for manual testing.
- [x] A Caddy route exposes only packaged archives, checksums, and an index page under
      `/drydock-downloads/`.
- [ ] If this remains useful, promote it from manual proof to a channel-owned
      package/publish script.

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

- [x] `schemas/release-manifest.schema.json` exists.
- [x] `releases/<version>.yaml` example exists.
- [x] Shared marketing version and per-channel build numbers are represented.
- [ ] Build/package scripts consume the release manifest.
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
- [ ] Epic adds channel folder + workflow without changing payload code.
- [ ] Any required shared contract changes are documented as artifact/host schema
      improvements, not ad hoc engine path access.

### 9. Second Engine Adapter: Unreal

- [ ] `platforms/desktop/build/unreal/` wraps `RunUAT BuildCookRun`.
- [ ] Unreal emits the same artifact manifest schema.
- [ ] Channel-owned Unreal plugin configuration is explicit.
- [ ] At least one existing desktop channel can package/publish an Unreal artifact through
      the same manifest-first flow.

## Definition Of Done For The Template

- Live Caddy-backed web iteration serves `game/` directly without duplicate source or repo
  root exposure.
- One release manifest plus channel tags can produce uploads to the VPS web channel,
  Steam, App Store, and Play.
- Every build adapter emits a valid `drydock-artifact.json`.
- Every host bridge implementation passes shared conformance tests for its claimed
  capabilities.
- SOPS+age is the only documented secret storage path for channel credentials.
- Adding a channel primarily adds one `channels/<channel>/` folder and one workflow.
- Swapping the payload or engine adapter does not require payload code to know about a
  store/channel.
- Console support is described only as a future/private extension until a real adapter and
  certification workflow exist.
