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

Build and publish the static artifact:

```sh
pnpm --filter @drydock/web-static build -- --release contracts/releases/0.1.0.yaml
pnpm --filter @drydock/channel-vps run publish -- artifacts/build/web-static/drydock-artifact.json
```

Validate Caddy before reload:

```sh
sudo caddy validate --adapter caddyfile --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

Verify both public routes after a change:

```sh
pnpm --filter @drydock/channel-vps run verify -- \
  --live-url https://games.example.com/drydock/ \
  --release-url https://games.example.com/drydock-release/
```

For render-level checks, use the Playwright smoke skill command:

```sh
pnpm smoke:web -- https://games.example.com/drydock/
pnpm smoke:web -- https://games.example.com/drydock-release/
```

The verifier expects the contract-selected product and Drydock host runtime paths to
return `200`. Product metadata, tests, package files, and repository internals must return
`404`.

## Caddy Templates

- `caddy.example` is for a dedicated hostname.
- `caddy.path.example` is for mounting under an existing hostname.

The path-mounted example uses `/drydock/` for the live iterate origin and
`/drydock-release/` for the configured packaged web root. Deployments may choose
different prefixes.
