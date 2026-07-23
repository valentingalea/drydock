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

## Iterate vs Release

| Workflow | Optimizes for | Source | Output | Public route |
|---|---|---|---|---|
| `platforms/web/iterate/caddy-live/` | Latency | Live `game/` tree | None | Caddy allowlist to localhost origin |
| `platforms/web/build/static/` + `platforms/web/channels/vps/` | Reproducibility | Release manifest + `game/` | `out/web-static/` + artifact manifest | Caddy route to clean packaged output |

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

Local listener checks should show the origin on localhost only:

```sh
ss -tlnp | grep ':8090'
```
