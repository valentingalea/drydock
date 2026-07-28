# Drydock Structure

```text
Drydock/
├─ contracts/
│  ├─ fixtures/       small generic schema/test inputs
│  ├─ host-bridge/    shared host protocol package
│  └─ schemas/        project, release, and artifact schemas
├─ platforms/
│  ├─ web/            live/static adapters and VPS channel
│  └─ desktop/        Electron adapter and downloads channel
├─ runtime/            Drydock-owned runtime injection
├─ templates/          portable consumer-project starting points
├─ test/               generic synthetic-project tests
├─ tools/              CLI, validation, composition, provenance
├─ docs/
├─ AGENTS.md
├─ README.md
├─ package.json
├─ pnpm-lock.yaml
└─ pnpm-workspace.yaml
```

Ownership rules:

| Path | Owns | Must not own |
|---|---|---|
| `contracts/` | Stable reusable interfaces and generic fixtures | A real game release |
| `platforms/` | Generic adapters and channel mechanics | Game source or destinations |
| `runtime/` | Drydock host code injected at reserved targets | Game behavior |
| `templates/` | Portable declarations to copy and customize | Deployable example product |
| `test/` | Synthetic project/security tests | External checkout assumptions |
| `tools/` | Project resolution, verification, composition, artifacts | Cwd fallbacks |

Drydock has no game submodule. Consumer repositories pin Drydock, not the reverse.
