# Web Iteration

Start the localhost-only composition origin from a game repository:

```sh
node drydock/tools/drydock.js iterate web \
  --project shipping/drydock-project.json \
  --port 8090
```

The iterator validates the selected project in development mode and reads declared
files directly. It injects the Drydock web host bridge and applies the same mappings and
overlay order used by staged builds. Refreshing the browser picks up game and component
edits without creating an artifact.

The server binds only to `127.0.0.1`. Put Caddy in front of it when a browser needs a
public hostname or path mount. Copy the adjacent Caddy examples and set their hostname,
route, and origin values for that deployment.

Only descriptor-composed runtime paths are served. Traversal, undeclared source,
repository metadata, the project descriptor, and component internals outside mappings
return `404`. The origin redirects `/` to the descriptor's composed entrypoint, using a
relative location so dedicated-hostname and path-mounted deployments behave the same.

Iteration is not a release path:

- it permits dirty development sources;
- it emits no artifact or provenance;
- it must not be used as the packaged release webroot.

For browser diagnostics, use the repository-local Playwright smoke skill against the
configured URL and verify both the entrypoint and a representative runtime import.
