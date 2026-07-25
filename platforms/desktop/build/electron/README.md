# Electron Build Adapter

This adapter wraps the descriptor-composed Line Engine calibration payload in a
store-neutral Electron shell.
Store-specific SDKs and upload behavior belong in desktop channel folders, not here.

## Build

```sh
pnpm --filter @drydock/desktop-electron build -- \
  --release contracts/releases/0.1.0.yaml \
  --platform linux \
  --arch x64
```

The default output is `artifacts/build/<platform>-<arch>/`, using manifest platform names such as
`linux`, `windows`, and `macos`.

The build stages a minimal Electron app, consumes `game/drydock-payload.json`, overlays
Drydock's platform host at Line Engine's extension point, runs `electron-builder --dir`,
and writes `drydock-artifact.json` next to the unpacked output. The manifest records the
pinned Line Engine revision.

## Runtime Contract

- `main.js` registers a privileged `app://drydock` protocol.
- `protocol.js` serves only composed runtime paths and adds CSP/security headers. Its
  script policy authorizes the exact Line Engine import-map hash without allowing
  arbitrary inline scripts.
- `preload.js` exposes `window.drydockHost` only.
- `host-provider.js` validates all IPC and implements local file-backed storage.

The base Electron host claims only local `storage`. Achievements, identity, purchases,
telemetry, overlays, cloud save, and entitlement checks remain unsupported until a desktop
channel supplies them.

## Current Caveat

`pnpm-workspace.yaml` explicitly denies the transitive `electron-winstaller` build script.
That is fine for the current Linux unpacked proof and keeps the dependency install surface
tighter. Revisit it only when a Windows installer target actually needs that package.
