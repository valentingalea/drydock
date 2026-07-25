# Caddy Live Iteration

This package starts the fast web iteration origin. It resolves
`game/drydock-payload.json` directly against the Line Engine submodule and Drydock host
overlay, binds to `127.0.0.1`, and relies on Caddy to expose only allowlisted runtime
paths.

```sh
pnpm --filter @drydock/web-iterate-caddy-live serve -- --port 8090
```

Do not serve the repo root, copy `engine/mock-game/`, or use this path as a release
artifact.

The server applies overlay entries from the descriptor at request time, so
`/engine/mock-game/src/platform-host.js` resolves to Drydock's protocol-v1 adapter while
the rest of the calibration client resolves directly from Line Engine. It warns on a
dirty or mismatched submodule to support active two-repository development; packaged
builds reject that state. Follow
[`docs/PAYLOAD.md`](../../../../docs/PAYLOAD.md) before committing a new engine pin.

If there is no spare DuckDNS hostname, mount this under an existing domain path such as
`/drydock/` with Caddy `handle_path`. The payload uses relative imports so path-mounted
testing works.

After starting the origin, verify the menu shows `host v1`, select Play, confirm
`data-line-state="play"` and one canvas, and check that Line Engine metadata such as
`/engine/package.json` returns `404`.
