# Architecture

## Dependency direction

Drydock is a tool dependency of a game repository. It does not embed or select a game.

```text
game repository
├─ game/       project-owned runtime and assets
├─ engine/     optional pinned engine component
├─ drydock/    pinned Drydock toolchain
├─ shipping/   project, release, integration, and channel declarations
└─ artifacts/  ignored generated output
```

The explicit `--project shipping/drydock-project.json` argument establishes the
canonical project root. Every subsequent project path is resolved below that root.

## Contracts

Four versions have separate meanings:

- project schema: JSON structure of `shipping/drydock-project.json`;
- Drydock contract: supported composition and command semantics;
- host protocol: API exposed to the game by a Drydock host;
- artifact schema: output manifest exchanged between pipeline stages.

Changing one does not silently change the others.

The project descriptor owns identity, host requirements, declared components, runtime
mappings, overlays, entrypoint, and the `artifacts/` output root. Release manifests own
version and per-adapter build numbers. Channel policy owns stable, non-secret settings
such as a validated `deploymentId`. Machine paths and public URLs are operational
inputs.

## Component verification

Components use one of two revision modes:

- `project`: files tracked by the enclosing game repository;
- `gitlink`: an initialized submodule at the exact gitlink commit.

Development verification permits dirty tracked content for iteration. Release
verification requires clean project/component trees and commits reachable from their
configured origins. Every file selected by a release runtime mapping, including files
reached through an in-component symbolic link, must be tracked by the recorded
component revision; ignored files outside the runtime composition remain irrelevant.
A releasable build additionally requires the running Drydock
checkout to be the exact clean `drydock/` gitlink, reachable from its origin.

## Runtime composition

The descriptor maps files or directories from declared components to runtime targets.
Later entries may overlay an earlier target only when `overlay: true` and the
file/directory types agree. Drydock reserves its host-runtime targets and injects them
itself.

One implementation serves live requests and stages builds. It rejects traversal,
restricted repository metadata, escaping or broken links, link swaps, ambiguous
overlays, and output outside `artifacts/`.

## Pipeline

```text
BUILD -> INTEGRATE -> PACKAGE / SIGN -> PUBLISH
```

- Build adapters compose source and emit `drydock-artifact.json`.
- Integration adds channel-owned runtime behavior where required.
- Packaging/signing turns a verified artifact into channel-ready files.
- Publishing copies or uploads only verified package output.

Development builds set `releasable: false`. Downstream release consumers reject them.
A releasable artifact records checksummed project/release declarations, exact revisions,
adapter/profile identity, optional channel policy, and checksums for staged files.
Recorded remote URLs retain neither user information nor query/fragment data, where
credentials are commonly embedded. Release provenance preflight completes before a
build adapter creates staging or output directories. Artifact paths reject
drive-qualified and Windows-aliased names. Consumers require the selected manifest to
be a regular non-symlink file and independently resolve the payload root to a real
directory contained by that manifest.

## Current adapters

- `iterate web`: localhost-only live composition, no artifact;
- `build web-static`: staged static web artifact;
- `build electron`: staged Electron application with an exact runtime path policy and
  hashed inline-script CSP;
- `package downloads`: checksummed direct-download zip and index;
- `publish vps`: namespaced static deployment;
- `publish downloads`: namespaced direct-download deployment.

Shared operational roots are safe for multiple games because each publisher replaces
only `<root>/<deploymentId>`. Caddy routes, service names, ports, hostnames, and base
roots remain explicit deployment configuration.
