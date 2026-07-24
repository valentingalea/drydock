# VPS Channel

This channel publishes a packaged web artifact to a Caddy-served directory. It is the
release path, not the live iteration path.

## External State

The repo owns the scripts and templates. The VPS owns the runtime state:

- `/var/www/drydock` is the packaged release root populated by `publish.js`.
- `/etc/caddy/Caddyfile` is the public routing boundary.
- `127.0.0.1:8090` is the optional live iteration origin.
- `/etc/systemd/system/drydock-web-iterate.service` may manage that live origin.

Treat changes to those paths as deploy state. Keep matching templates or notes in this
repo so another agent can reconstruct the VPS.

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
  --live-url https://vinyltin.duckdns.org/drydock/ \
  --release-url https://vinyltin.duckdns.org/drydock-release/
```

For render-level checks, use the Playwright smoke skill command:

```sh
pnpm smoke:web -- https://vinyltin.duckdns.org/drydock/
pnpm smoke:web -- https://vinyltin.duckdns.org/drydock-release/
```

The verifier expects runtime paths, including nested vendored module files such as
`/vendor/three/three.core.min.js`, to return `200` and repo/internal paths to return `404`.

## Caddy Templates

- `caddy.example` is for a dedicated hostname.
- `caddy.path.example` is for mounting under an existing hostname.

The current VPS proof uses the path-mounted shape:

- `/drydock/` reverse proxies to the live iterate origin.
- `/drydock-release/` serves `/var/www/drydock`.
