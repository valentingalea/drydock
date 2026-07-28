# VPS Channel

This channel publishes a packaged web artifact to a Caddy-served directory. It is the
release path, not the live iteration path.

The static adapter has already resolved the external project contract, added Drydock's
generic host runtime, and recorded project/component provenance before this channel sees
the artifact. The VPS publisher consumes the schema-v3 manifest and packaged tree only;
it never reads source checkouts and rejects artifacts unless `releasable` is explicitly
`true`.

## Deployment State

The repository owns scripts and templates. Each deployment chooses and owns:

- the packaged release root populated by `publish.js`;
- the installed Caddy configuration;
- the public hostname and route prefixes;
- the service unit and unprivileged account for the optional localhost iteration origin.

Treat those values as deploy state. Do not copy an individual host's paths, users, or
domains into the repository templates.

## Release Route

Build and publish the static artifact. The committed VPS policy supplies a unique
`deploymentId`; the operational root is supplied explicitly and the publisher deploys
to `<root>/<deploymentId>`:

```sh
node drydock/tools/drydock.js build web-static \
  --project shipping/drydock-project.json \
  --release shipping/releases/0.1.0.yaml

DRYDOCK_VPS_ROOT=/srv/games \
  node drydock/tools/drydock.js publish vps \
    --project shipping/drydock-project.json \
    --artifact artifacts/build/web-static/drydock-artifact.json
```

Validate Caddy before reload:

```sh
sudo caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Verify both public routes after a change:

```sh
pnpm --dir drydock --filter @drydock/channel-vps run verify -- \
  --artifact artifacts/build/web-static/drydock-artifact.json \
  --live-url https://game.example/live/ \
  --release-url https://game.example/releases/
```

For render-level checks, use the Playwright smoke skill command:

```sh
pnpm --dir drydock smoke:web -- https://game.example/live/
pnpm --dir drydock smoke:web -- https://game.example/releases/
```

The verifier expects artifact-selected runtime and Drydock host paths to return `200`.
Project metadata, tests, package files, and repository internals must return
`404`. Artifact path segments are URL-encoded before verification, so filenames
containing URL delimiter characters are checked literally. For a custom entrypoint,
the release route also checks the static adapter's generated root `index.html`
redirect; the live route checks the composed entrypoint without requiring that
release-only file.

## Caddy Templates

- `caddy.example` is for a dedicated hostname.
- `caddy.path.example` is for mounting under an existing hostname.

The path-mounted templates use explicit route variables for the live origin and
packaged web root. Set `DRYDOCK_WEB_ROOT` to the complete published
`<operational-root>/<deploymentId>` directory.
