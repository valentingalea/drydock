# Drydock

Drydock is a productless toolchain for validating, building, packaging, and publishing
game repositories. A game pins Drydock at `drydock/`, owns its source under `game/`,
declares composition in `shipping/drydock-project.json`, and keeps generated output
under ignored `artifacts/`.

Drydock supplies generic web and Electron adapters, a host bridge, artifact contracts,
and channel tools. It contains no game checkout, real release manifest, deployment
destination, or hosted CI workflow.

## Start in a game repository

```sh
corepack enable
pnpm --dir drydock install --frozen-lockfile

node drydock/tools/drydock.js validate \
  --project shipping/drydock-project.json

node drydock/tools/drydock.js iterate web \
  --project shipping/drydock-project.json \
  --port 8090
```

Copy and adapt [`templates/project/`](templates/project/) when creating a consumer.
All project paths are resolved from the selected descriptor, so commands may be invoked
from any working directory.

## Work on Drydock

```sh
corepack enable
pnpm install --frozen-lockfile
npm test
npm run validate
```

The release pipeline is:

```text
BUILD -> INTEGRATE -> PACKAGE / SIGN -> PUBLISH
```

Fast iteration is deliberately outside that pipeline and never produces a releasable
artifact.

Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md),
[`docs/PROJECT.md`](docs/PROJECT.md), and [`docs/RELEASE.md`](docs/RELEASE.md) for the
contracts and manual workflow.
