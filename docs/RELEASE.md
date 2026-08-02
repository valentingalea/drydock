# Manual Release Workflow

Run releases from a recursively initialized game repository. Drydock does not provide
or require a hosted CI workflow.

## Preconditions

1. Install the game, engine, and Drydock dependencies using their own manifests.
2. Commit the project descriptor, release manifest, channel policy, and integrations.
3. Commit all game changes and exact component gitlinks.
4. Push the game, Drydock, and external component commits to their configured origins.
5. Confirm `git status --short` is empty in the game and every submodule.
6. Supply operational roots, URLs, and any secret environment variables explicitly.

Validate the project:

```sh
node drydock/tools/drydock.js validate \
  --project shipping/drydock-project.json
```

Release-profile builds fail if the enclosing project, declared components, or exact
`drydock/` gitlink are dirty, unpinned, or unreachable from their origins.

## Static web to VPS

```sh
node drydock/tools/drydock.js build web-static \
  --project shipping/drydock-project.json \
  --release shipping/releases/0.1.0.yaml \
  --channel vps \
  --channel-policy shipping/channels/vps.yaml

DRYDOCK_VPS_ROOT=/srv/games \
  node drydock/tools/drydock.js publish vps \
    --project shipping/drydock-project.json \
    --artifact artifacts/build/web-static/drydock-artifact.json
```

The artifact contains the committed VPS policy snapshot. The publisher verifies the
manifest and every staged checksum, requires `releasable: true`, then replaces only
`<DRYDOCK_VPS_ROOT>/<deploymentId>`.

The built-in browser host guarantees local `storage` only. Static web builds reject
projects that require achievements, telemetry, purchases, or identity until a web
adapter supplies those capabilities.

Verify the configured public routes using the same artifact:

```sh
npx --yes pnpm@11.17.0 --dir drydock --filter @drydock/channel-vps run verify -- \
  --artifact artifacts/build/web-static/drydock-artifact.json \
  --live-url https://game.example/live/ \
  --release-url https://game.example/releases/
```

## Electron to direct downloads

```sh
node drydock/tools/drydock.js build electron \
  --project shipping/drydock-project.json \
  --release shipping/releases/0.1.0.yaml \
  --platform windows \
  --arch x64

node drydock/tools/drydock.js package downloads \
  --project shipping/drydock-project.json \
  --artifact artifacts/build/windows-x64/drydock-artifact.json

DRYDOCK_DOWNLOADS_ROOT=/srv/games \
  node drydock/tools/drydock.js publish downloads \
    --project shipping/drydock-project.json \
    --source artifacts/packages/downloads
```

Packaging rejects non-releasable or checksum-invalid artifacts. Publishing resolves the
package directory below project `artifacts/`, verifies each zip checksum, reads
`shipping/channels/downloads.yaml`, and replaces only
`<DRYDOCK_DOWNLOADS_ROOT>/<deploymentId>`.

Verify the public package:

```sh
npx --yes pnpm@11.17.0 --dir drydock --filter @drydock/channel-downloads run verify -- \
  --base-url https://game.example/downloads/ \
  --name example-game-0.1.0-windows-x64.zip
```

## Development diagnostics

Web and Electron builders accept `--profile development`. Electron additionally allows
`--skip-package` in that profile. These modes are for local adapter diagnostics:

```sh
node drydock/tools/drydock.js build electron \
  --project shipping/drydock-project.json \
  --release shipping/releases/0.1.0.yaml \
  --profile development \
  --skip-package
```

Development artifacts are marked `releasable: false`; release packaging and publishing
must reject them.

## Operational rollback

Current local publishers replace a single namespaced deployment atomically only at the
directory-selection level; they do not retain history. Before production use, the host
operator should snapshot or rename the previous `<root>/<deploymentId>` and validate
Caddy configuration before reload. Rollback policy belongs to the deployment, not the
game repository.
