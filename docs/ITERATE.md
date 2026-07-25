# Iterate

Fast iteration is a first-class workflow, but it is not a release channel.

The current payload is Line Engine's canonical calibration mock. Edit
`engine/mock-game/`, `engine/src/`, or `engine/style/`, refresh the public Caddy URL, and
see the change without a build or deploy step. Drydock does not maintain a copied mock.

## Model

```text
game/drydock-payload.json
  ├─ game/index.html
  ├─ game/host-bridge.js
  ├─ game/overlays/platform-host.js
  └─ engine/{mock-game,src,style,lib}
           |
           v
descriptor-resolved origin on 127.0.0.1:8090
           |
           v
Caddy runtime allowlist
```

The origin maps URL paths directly to the declared live source files. The Drydock
platform-host overlay is served at
`/engine/mock-game/src/platform-host.js`; all other mock files come directly from the
submodule. There is no runtime copy or symlink mirror.

The root launcher redirects relatively to `./engine/mock-game/index.html`, so both
hostname-root and path-mounted routes work.

## Why Not Serve The Repo Root?

The origin is a resolver, not a general file server. It returns a file only when
`game/drydock-payload.json` maps the requested runtime path.

This prevents `.git/`, release manifests, docs, tooling, secrets, Line Engine tests, and
submodule metadata from becoming public even before Caddy applies its second allowlist.

## Caddy Allowlist

The maintained examples allow:

```text
/
/index.html
/host-bridge.js
/vendor/drydock-host-bridge/*
/engine/mock-game/
/engine/mock-game/index.html
/engine/mock-game/src/*
/engine/mock-game/style/*
/engine/src/*
/engine/style/*
/engine/lib/*
```

They deny everything else. In particular, these must remain unavailable:

```text
/engine/.git
/engine/AGENTS.md
/engine/package.json
/engine/test/*
/drydock-artifact.json
```

Expand both the descriptor and Caddy allowlist only when the payload imports a real new
runtime path.

## Origin Rules

- Bind to `127.0.0.1`, never `0.0.0.0`.
- Resolve only descriptor-selected runtime files.
- Send no-cache headers.
- Run `engine/tools/verify-submodule.sh --start` and warn on dirty/stale pins.
- Do not read SOPS secrets.
- Do not emit `drydock-artifact.json`.
- Do not become an input to release verification.

Start it with:

```sh
pnpm --filter @drydock/web-iterate-caddy-live serve -- --port 8090
```

The live public route at `https://vinyltin.duckdns.org/drydock/` is meant to be backed by
`platforms/web/iterate/caddy-live/systemd/drydock-web-iterate.service.example`.

Example install flow:

```sh
sudo cp platforms/web/iterate/caddy-live/systemd/drydock-web-iterate.service.example \
  /etc/systemd/system/drydock-web-iterate.service
sudo systemctl daemon-reload
sudo systemctl enable --now drydock-web-iterate.service
systemctl status drydock-web-iterate.service
```

Adjust `User=`, `Group=`, and repository paths on other hosts.

Current VPS note: Node 25 is installed under root's NVM tree, so the installed unit uses
that explicit binary path and runs as root with systemd filesystem, capability, address,
and privilege restrictions. Move Node to a system-readable location and switch the unit
to an unprivileged `drydock` account when the host toolchain is normalized.

## Iterate vs Release

| Workflow | Source | Output |
|---|---|---|
| `platforms/web/iterate/caddy-live/` | Live descriptor mappings | None |
| `platforms/web/build/static/` + VPS channel | Pinned submodule + release manifest + descriptor | Clean static artifact + manifest |

The release build stages the same URL layout, applies the same host overlay, records the
Line Engine commit in `drydock-artifact.json`, and copies no repository-only files.

## Verification

```sh
curl -sI https://example.com/drydock/engine/mock-game/index.html       # 200
curl -sI https://example.com/drydock/engine/src/core/scope.js          # 200
curl -sI https://example.com/drydock/engine/lib/three.module.js         # 200
curl -sI https://example.com/drydock/engine/AGENTS.md                   # 404
curl -sI https://example.com/drydock/engine/package.json                # 404
curl -sI https://example.com/drydock/.git/config                        # 404
```

Render-level smoke must load the menu, report `host v1`, click Play, reach
`data-line-state="play"`, and find one calibration canvas.

Local listener checks should show localhost only:

```sh
ss -tlnp | grep ':8090'
```
