# Electron Build Adapter

This adapter wraps a contract-composed project in a store-neutral Electron shell.
Store-specific SDKs and upload behavior belong in desktop channel folders, not here.

## Build

```sh
node drydock/tools/drydock.js build electron \
  --project shipping/drydock-project.json \
  --release shipping/releases/0.1.0.yaml \
  --platform linux \
  --arch x64
```

The default output is `artifacts/build/<platform>-<arch>/`, using manifest platform names such as
`linux`, `windows`, and `macos`.

The build validates the external project and its declared components, stages a minimal
Electron app through the shared runtime composition, runs `electron-builder --dir`, and
writes `drydock-artifact.json` next to the unpacked output.
It invokes the adapter package's pinned `electron-builder` CLI directly through Node;
no global binary or caller-modified `PATH` is required.

Release builds require clean, reachable project and component revisions. Use
`--profile development --skip-package` only for local adapter diagnostics; that path
creates a fake unpacked executable and is not a publishable build.

## Runtime Contract

- `main.js` registers a privileged `app://drydock` protocol.
- `protocol.js` serves only the exact paths in the generated `runtime-policy.json` and
  adds CSP/security headers.
- The staged policy records and launches the selected entrypoint and hashes inline
  scripts in every served HTML document, including import maps, without enabling
  arbitrary inline JavaScript.
- Temporary runtime staging is removed on both successful and failed build attempts.
- `preload.js` exposes `window.drydockHost` only.
- `host-provider.js` validates all IPC and implements local file-backed storage.

The base Electron host claims only local `storage`. Achievements, identity, purchases,
telemetry, overlays, cloud save, and entitlement checks remain unsupported until a desktop
channel supplies them. Electron builds reject a project that requires an unsupported
base-host capability.

## Current Caveat

`pnpm-workspace.yaml` explicitly denies the transitive `electron-winstaller` build script.
That is fine for the current Linux unpacked proof and keeps the dependency install surface
tighter. Revisit it only when a Windows installer target actually needs that package.
