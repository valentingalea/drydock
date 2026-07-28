# Toolchain

## Install

Drydock declares Node, pnpm, and all adapter dependencies in its own repository:

```sh
corepack enable
pnpm install --frozen-lockfile
```

When Drydock is a game submodule, install it without merging dependency graphs:

```sh
pnpm --dir drydock install --frozen-lockfile
```

The game and its engine keep their own manifests and installation commands.

## Public CLI

Use only the project-aware entrypoint for game work:

```sh
node drydock/tools/drydock.js <command> \
  --project shipping/drydock-project.json
```

Implemented commands:

```text
validate
iterate web
build web-static
build electron
package downloads
publish vps
publish downloads
```

Project inputs such as releases, policies, artifacts, and package directories are
project-relative. Outputs must remain below the selected project's `artifacts/`.
Operational roots are absolute, explicit publisher inputs and are never inferred from
the current directory.

## Dependency boundaries

- `contracts/host-bridge` owns the shared protocol package.
- Each platform/channel directory owns its adapter dependencies.
- `runtime/web/vendor/` is regenerated from the shared host bridge with `npm run vendor`.
- Native SDKs, signing tools, caches, and credentials remain external or ignored.

## Verification

```sh
npm test
npm run validate
```

The tests create temporary synthetic game repositories. They do not require a bundled
game or external engine checkout.
