# Structure

Drydock keeps the root intentionally small. Source folders are grouped by purpose instead
of by implementation accident.

```text
drydock/
├─ engine/                        # Line Engine git submodule; owns the canonical mock
├─ .gitmodules                    # canonical Line Engine remote + submodule path
├─ game/                          # Drydock payload composition and host integration
│  ├─ drydock-payload.json        # identity, entrypoint, runtime mappings, overlays
│  ├─ index.html                  # launcher to engine/mock-game/
│  ├─ package.json
│  ├─ test/
│  ├─ overlays/platform-host.js   # replaces Line Engine's documented host extension
│  ├─ vendor/                     # vendored Drydock host bridge only
│  └─ host-bridge.js              # payload-facing bridge shim
│
├─ platforms/                     # build adapters, iteration paths, release channels
│  ├─ web/
│  │  ├─ iterate/
│  │  │  └─ caddy-live/           # live descriptor resolver for browser feedback
│  │  ├─ build/
│  │  │  └─ static/               # copies runtime files into artifacts/build/web-static/
│  │  └─ channels/
│  │     └─ vps/                  # deploy packaged web artifact through Caddy
│  │
│  ├─ desktop/
│  │  ├─ build/
│  │  │  ├─ electron/             # engine/runtime build adapter
│  │  │  └─ unreal/               # future UE desktop build via RunUAT
│  │  └─ channels/
│  │     ├─ downloads/            # direct-download test packages
│  │     ├─ steam/
│  │     ├─ epic/
│  │     ├─ gog/
│  │     └─ itch/
│  │
│  └─ mobile/
│     ├─ build/
│     │  └─ capacitor/
│     ├─ native/
│     │  ├─ ios/
│     │  └─ android/
│     └─ channels/
│        ├─ appstore/
│        └─ play/
│
├─ contracts/                     # shared definitions consumed across layers
│  ├─ host-bridge/                # typed host API + conformance tests
│  ├─ schemas/                    # artifact and release manifest schemas
│  ├─ fixtures/                   # valid/invalid contract examples
│  └─ releases/                   # release manifests, one file per candidate
│
├─ artifacts/                     # ignored generated output root
│  ├─ build/                      # build adapter output and drydock-artifact.json
│  ├─ channels/                   # package output such as direct-download zips
│  ├─ smoke/                      # Playwright reports/screenshots
│  └─ tmp/                        # staging directories
│
├─ tools/                         # utilities and repo-local agent workflows
│  ├─ scripts/
│  │  ├─ payload.js               # shared descriptor loader/resolver/stager
│  │  └─ ...                      # validators, vendoring, fetch helpers
│  └─ skills/                     # Codex skills future agents can reuse
│
├─ docs/                          # project design, release, and workflow docs
├─ .sops.yaml                     # age recipients authorized to decrypt SOPS files
├─ .github/workflows/             # one pipeline per release channel
├─ package.json
├─ pnpm-workspace.yaml
├─ pnpm-lock.yaml
├─ AGENTS.md
└─ README.md
```

`node_modules/` is intentionally absent from the architecture. It is pnpm-generated
install state and stays ignored.

## Directory Responsibilities

| Path | Owns | Must not |
|---|---|---|
| `engine/` | Pinned Line Engine runtime and sole canonical mock | Contain Drydock/channel changes outside its documented extension contract |
| `game/` | Payload descriptor, launcher, and Drydock host adapter | Duplicate Line Engine mock presentation or gameplay |
| `platforms/*/iterate/<mode>/` | Fast feedback loops such as Caddy-backed web iteration | Emit release artifacts or read secrets |
| `platforms/*/build/<adapter>/` | Platform shell/compiler and artifact build adapter | Hard-code release channels or duplicate descriptor mappings |
| `platforms/*/channels/<channel>/` | Channel SDK integration, metadata, package/sign scripts, publish tooling | Reach into engine internals without going through `drydock-artifact.json` |
| `platforms/mobile/native/{ios,android}/` | OS-native generated projects and durable native extension points | Hold App Store / Play release metadata directly |
| `contracts/host-bridge/` | Typed bridge API, error model, conformance tests | Contain platform SDK code |
| `contracts/schemas/` | Artifact and release manifest schemas | Encode one engine's private paths as required fields |
| `contracts/fixtures/` | Small sample manifests for validation and docs | Become a second source of truth for real release outputs |
| `contracts/releases/` | Version/build/channel release manifests | Store credentials |
| `artifacts/` | Ignored build output, package output, smoke reports, and temporary staging | Store source, docs, contracts, credentials, or hand-edited release inputs |
| `tools/scripts/` | Repeatable helper scripts and validators | Hold channel-specific SDK integration or secrets |
| `tools/skills/` | Repo-local Codex skills and reusable agent workflows | Replace project docs or hide required release behavior |
| `docs/` | Architecture, workflow, release, and roadmap docs | Own executable release behavior |
| `.github/workflows/` | One workflow per release channel | Decrypt another channel's secrets |

## Invariants

- `engine/mock-game/` is the only canonical mock. Drydock never copies it into `game/`.
- Line Engine source changes are committed and pushed in the Line Engine repository
  before Drydock records the new `engine/` gitlink.
- Every target consumes `game/drydock-payload.json`; runtime source mappings and overlays
  must not be reimplemented independently by adapters.
- Web iteration resolves live descriptor-selected files without copying or symlinking a
  second source mirror.
- Public live iteration origins bind to `127.0.0.1` and rely on Caddy allowlists. They do
  not serve the repo root.
- Every build adapter emits `drydock-artifact.json` under `artifacts/build/<target>/` and
  validates it against `contracts/schemas/drydock-artifact.schema.json`.
- Channel tooling consumes the artifact manifest first. It must fail early if required
  fields or capabilities are missing.
- A new channel should add one `channels/<channel>/` folder and one workflow. Shared
  contract changes are allowed only when the existing artifact or host bridge contract
  cannot express a real requirement.
- A new native compiler/runtime that cannot use an existing shell adds one
  `build/<adapter>/` folder and must prove compatibility with at least one existing
  channel. A browser payload runtime may reuse the current web/Electron adapters through
  the descriptor contract.
- SOPS encrypted files may be committed. Plaintext secrets, signing material, SDK caches,
  generated build outputs, and personal credentials are ignored.
