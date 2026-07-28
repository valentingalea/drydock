# Caddy Live Iteration

This package starts the fast web iteration origin. It validates the external project's
`shipping/drydock-project.json`, composes only its declared runtime files with Drydock's
web host runtime, and binds to `127.0.0.1`.

```sh
node drydock/tools/drydock.js iterate web \
  --project shipping/drydock-project.json \
  --port 8090
```

Run the command from the enclosing game repository. Do not serve a repository root,
copy source files, or use this path as a release artifact. The live origin and staged
builds share the same mapping and overlay implementation.

The project owns all source mappings and reviewed integrations. Drydock supplies only
`host-bridge.js` and its vendored runtime contract. Development iteration permits dirty
tracked component files; release builds apply stricter revision checks. Live reads
revalidate the affected overlay path after source-tree edits, while staging revalidates
the complete effective tree before copying it.

Mount this under a dedicated hostname or an existing domain path such as `/game/` with
Caddy `handle_path`. Caddy proxies to the localhost-only origin; the origin itself
enforces the descriptor-derived allowlist, redirects `/` to the declared entrypoint,
and returns `404` for undeclared files.

The Caddy examples require deployment-specific hostname/route, origin, and log
variables. When installing the systemd example, give each game a unique unit filename,
service account, project root, and port.

After starting the origin, verify the declared entrypoint and runtime imports load, and
confirm that project metadata such as `/shipping/drydock-project.json` returns `404`.
