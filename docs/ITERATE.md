# Iterate

Fast iteration is a first-class workflow, but it is not a release channel.

The purpose is immediate on-device feedback for web payload work: edit `game/index.html`
or `game/src/*.js`, refresh the public Caddy URL, and see the change without a build or
deploy step.

## Model

```text
game/                         # canonical source
platforms/web/iterate/caddy-live/
  start.sh                    # localhost-only origin serving game/
  caddy.example               # public TLS route + tight allowlist
```

The live origin serves `game/` directly as its document root:

```text
127.0.0.1:8090 -> /usr/games/Drydock/game
```

Caddy is the public boundary:

```text
https://drydock.example.com -> Caddy allowlist -> 127.0.0.1:8090 -> game/
```

There is no copied source folder and no symlinked mirror. `game/` remains the only source
of truth.

## Why Not Serve The Repo Root?

Do not serve `/usr/games/Drydock` directly. Serve `/usr/games/Drydock/game`.

Mudline's current deployment safely exposes a repo root by using strict Caddy allowlists,
but Drydock should start from a tighter default: if the origin root is `game/`, a bad
allowlist cannot expose `.git/`, project docs, release manifests, schemas, tooling, or
future channel scaffolding.

## Caddy Allowlist

The live Caddy route should allow only runtime paths:

```caddy
drydock.example.com {
    encode gzip zstd

    @allowed path / /index.html /host-bridge.js /src/* /assets/* /vendor/*
    handle @allowed {
        reverse_proxy 127.0.0.1:8090
    }

    handle {
        respond 404
    }

    log {
        output file /var/log/caddy/drydock-access.log
    }
}
```

Expand the allowlist only when the payload actually imports a new runtime path such as
`/wasm/*`, `/audio/*`, or `/textures/*`.

## No Spare Domain

A dedicated subdomain is cleanest, but it is not required. If no DuckDNS domains are
available, mount Drydock under a path on an existing domain:

```caddy
existing.example.com {
    encode gzip zstd

    redir /drydock /drydock/ 308
    handle_path /drydock/* {
        @allowed path / /index.html /host-bridge.js /src/* /assets/* /vendor/*
        handle @allowed {
            reverse_proxy 127.0.0.1:8090
        }

        handle {
            respond 404
        }
    }
}
```

This keeps the current domains intact and avoids hijacking a whole hostname. The payload
must use relative imports and asset URLs so it works both at `/` and under `/drydock/`.
Temporary whole-domain hijacks should be a last resort.

## Origin Rules

- Bind to `127.0.0.1`, never `0.0.0.0`.
- Serve `game/` as the document root, not the repo root.
- Send no-cache headers so browser refreshes reflect source edits immediately.
- Do not read SOPS secrets.
- Do not emit `drydock-artifact.json`.
- Do not become an input to release verification.

The expected implementation is a small wrapper around:

```sh
python3 -m http.server 8090 --bind 127.0.0.1 --directory /usr/games/Drydock/game
```

Current VPS note: the live public route at
`https://vinyltin.duckdns.org/drydock/` is meant to be backed by
`platforms/web/iterate/caddy-live/systemd/drydock-web-iterate.service.example` installed
as a local systemd service. Until that unit is installed and enabled, the route depends on
a manually started origin on `127.0.0.1:8090` and will not survive reboot or process exit.

Example install flow:

```sh
sudo cp platforms/web/iterate/caddy-live/systemd/drydock-web-iterate.service.example \
  /etc/systemd/system/drydock-web-iterate.service
sudo systemctl daemon-reload
sudo systemctl enable --now drydock-web-iterate.service
systemctl status drydock-web-iterate.service
```

Adjust `User=`, `Group=`, and repo paths before installing on a host that does not match
`/usr/games/Drydock`.

## Iterate vs Release

| Workflow | Optimizes for | Source | Output | Public route |
|---|---|---|---|---|
| `platforms/web/iterate/caddy-live/` | Latency | Live `game/` tree | None | Caddy allowlist to localhost origin |
| `platforms/web/build/static/` + `platforms/web/channels/vps/` | Reproducibility | Release manifest + `game/` | `artifacts/build/web-static/` + artifact manifest | Caddy route to clean packaged output |

Use iteration for feel, UI, rendering, and device smoke checks. Use the VPS release
channel when the result needs to be archived, compared, promoted, or reproduced.

## Verification

Public checks should include both allowed and denied paths:

```sh
curl -sI https://drydock.example.com/                 # expect 200
curl -sI https://drydock.example.com/index.html       # expect 200
curl -sI https://drydock.example.com/src/main.js      # expect 200 once it exists
curl -sI https://drydock.example.com/../AGENTS.md     # expect 404
curl -sI https://drydock.example.com/.git/config      # expect 404
curl -sI https://drydock.example.com/package.json     # expect 404
```

For path-mounted testing, replace the host root with the mounted path:

```sh
curl -sI https://existing.example.com/drydock/              # expect 200
curl -sI https://existing.example.com/drydock/src/main.js   # expect 200
curl -sI https://existing.example.com/drydock/package.json  # expect 404
```

Local listener checks should show the origin on localhost only:

```sh
ss -tlnp | grep ':8090'
```
