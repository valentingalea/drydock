# Iterate

Fast iteration is a first-class workflow, but it is not a release channel.

Set `DRYDOCK_PRODUCT_ROOT` to the standalone product repository you are actively editing:

```sh
DRYDOCK_PRODUCT_ROOT=/usr/games/engine \
  pnpm --filter @drydock/web-iterate-caddy-live serve -- --port 8090
```

The persistent VPS service sets the same variable. Edit the product, refresh
`https://vinyltin.duckdns.org/drydock/`, and see the change without copying, committing,
pulling, advancing Drydock's gitlink, building, or deploying.

When no override is set, iteration falls back to Drydock's pinned `product/` submodule.

## Model

```text
DRYDOCK_PRODUCT_ROOT/drydock-product.json
  + contract-selected product sources
  + product-owned Drydock adapter
  + Drydock runtime/web host files
           |
           v
contract resolver on 127.0.0.1:8090
           |
           v
Caddy allowlist
```

The origin resolves URL paths directly to selected source files. It does not create a
runtime copy or symlink mirror. The current root launcher redirects relatively to
`./product/mock-game/index.html`, so both hostname-root and path-mounted routes work.

## Safety Boundary

The resolver returns a file only when the product contract or Drydock's reserved runtime
maps that URL. It does not serve either repository root.

Caddy permits:

```text
/
/index.html
/host-bridge.js
/vendor/drydock-host-bridge/*
/product/*
```

The resolver still denies product files not selected by the contract, including:

```text
/product/.git
/product/AGENTS.md
/product/package.json
/product/drydock-product.json
/product/test/*
/drydock-artifact.json
```

The origin must:

- bind to `127.0.0.1`, never `0.0.0.0`;
- validate the external product's `drydock-product.json`;
- send no-cache headers;
- read no SOPS secrets;
- emit no artifact manifest;
- never become release evidence.

## Persistent Service

The live route is backed by
`platforms/web/iterate/caddy-live/systemd/drydock-web-iterate.service.example`.
Set the product checkout in the installed unit:

```ini
Environment=DRYDOCK_PRODUCT_ROOT=/usr/games/engine
```

Then reload and restart:

```sh
sudo systemctl daemon-reload
sudo systemctl restart drydock-web-iterate.service
systemctl status drydock-web-iterate.service
```

Current VPS note: Node 25 is installed under root's NVM tree, so the installed unit uses
that explicit binary and runs as root with systemd restrictions. Move Node to a
system-readable location and switch to an unprivileged `drydock` account when the host
toolchain is normalized.

## Iterate vs Release

| Workflow | Product source | Output |
|---|---|---|
| Live iterator | `DRYDOCK_PRODUCT_ROOT`, falling back to `product/` | None |
| Static/Electron build | Exact pinned `product/` gitlink | Clean artifact + schema-v2 manifest |

Release builds ignore `DRYDOCK_PRODUCT_ROOT`, strictly verify the pinned product, stage
the same runtime URL layout, and record `extensions.drydock.productRevision`.

## Verification

```sh
curl -sI https://example.com/drydock/product/mock-game/index.html       # 200
curl -sI https://example.com/drydock/product/src/core/scope.js          # 200
curl -sI https://example.com/drydock/product/lib/three.module.js         # 200
curl -sI https://example.com/drydock/product/AGENTS.md                   # 404
curl -sI https://example.com/drydock/product/drydock-product.json        # 404
curl -sI https://example.com/drydock/.git/config                         # 404
```

For the current proof product, render-level smoke must load the menu, report `host v1`,
click Play, reach `data-line-state="play"`, and find one calibration canvas:

```sh
pnpm smoke:web -- https://vinyltin.duckdns.org/drydock/
pnpm smoke:web -- https://vinyltin.duckdns.org/drydock-release/
```

Local listener checks should show localhost only:

```sh
ss -tlnp | grep ':8090'
```

See [`PRODUCT.md`](./PRODUCT.md) for committing the product and advancing the release
pin.
