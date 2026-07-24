# Caddy Live Iteration

This package starts the fast web iteration origin. It serves `game/` directly, binds to
`127.0.0.1`, and relies on Caddy to expose only allowlisted runtime paths.

```sh
pnpm --filter @drydock/web-iterate-caddy-live serve -- --port 8090
```

Do not serve the repo root and do not use this path as a release artifact.

If there is no spare DuckDNS hostname, mount this under an existing domain path such as
`/drydock/` with Caddy `handle_path`. The payload uses relative imports so path-mounted
testing works.
