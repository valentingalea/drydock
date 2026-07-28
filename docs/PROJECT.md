# External Game Project

Every Drydock command selects a game with:

```sh
--project shipping/drydock-project.json
```

The descriptor must live at that exact path inside the game repository. Its enclosing
directory establishes all other paths; the caller's working directory matters only
while resolving the initial `--project` argument.

## Repository shape

```text
game-repository/
├─ engine/                         optional external engine gitlink
├─ drydock/                        pinned Drydock gitlink
├─ game/                           game-owned source, assets, tests, docs, tools
├─ shipping/
│  ├─ drydock-project.json
│  ├─ integrations/drydock/
│  ├─ releases/
│  └─ channels/
├─ artifacts/                      ignored generated output
├─ .gitmodules
├─ .gitignore
├─ AGENTS.md
├─ package.json
└─ README.md
```

Keep the root shallow. Put substantive game content under `game/`, declarations under
`shipping/`, and all transient build/package/smoke output under `artifacts/`.

## Descriptor

Start from [`../templates/project/shipping/drydock-project.json`](../templates/project/shipping/drydock-project.json).
The main fields are:

- `schemaVersion`: descriptor JSON schema;
- `drydockContract`: composition/CLI semantics required by the project;
- `product`: stable ID, display name, executable name, and application ID; the display
  name may contain spaces but not path separators or dot-directory names;
- `host`: required host protocol and capabilities;
- `components`: project-owned directories and exact gitlinks;
- `runtime`: entrypoint and ordered source-to-runtime mappings;
- `artifacts.root`: always `artifacts`.

Component paths and mapping paths are repository-relative and may not escape their
owners. Source restrictions apply to the complete component-root-plus-source path, so
nested component roots cannot reintroduce project tests, docs, secrets, Git metadata,
or artifacts. Any component below root `shipping/` may select only an explicit file
below `shipping/integrations/`; a shipping overlay must also set `overlay: true`.
Validation requires the final overlaid entrypoint to exist as a file. Drydock reserves
its host-runtime paths, generated metadata, and channel-private root paths:
`.drydock-channel`, `.git/`, `drydock-artifact.json`, `package.json`, and `shipping/`.
Custom web entrypoints also leave root `index.html` available for Drydock's relative
redirect document.

## Revision profiles

`iterate web` uses development verification so local edits appear immediately. Build
commands default to release verification:

- the game commit is clean and reachable from `origin`;
- each `gitlink` is initialized, clean, and at its recorded pin;
- each required commit is reachable from its component origin;
- `drydock/` is the exact clean gitlink used to run the command.

Use `--profile development` only for local diagnostics. Its artifacts are marked
non-releasable and cannot be packaged or published.

## Policy and operations

Commit stable channel policy beneath `shipping/channels/`, including a distinct
lowercase `deploymentId` for each public channel. Do not commit host filesystem roots,
account names, private hostnames, credentials, or local checkout paths. Supply those
when running the publisher or through an explicit environment variable.
