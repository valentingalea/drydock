# Structure

Drydock keeps the root intentionally small. Source folders are grouped by purpose instead
of by implementation accident.

```text
drydock/
├─ product/                       # pinned complete-product git submodule
│  └─ drydock-product.json        # product-owned identity and runtime composition
├─ .gitmodules                    # product repository URL + submodule path
├─ runtime/
│  └─ web/
│     ├─ host-bridge.js           # Drydock-owned browser host runtime
│     └─ vendor/                  # vendored shared host contract
│
├─ platforms/                     # build adapters, iteration paths, release channels
│  ├─ web/
│  │  ├─ iterate/
│  │  │  └─ caddy-live/           # live product-contract resolver
│  │  ├─ build/
│  │  │  └─ static/               # copies runtime files into artifacts/build/web-static/
│  │  └─ channels/
│  │     └─ vps/                  # deploy packaged web artifact through Caddy
│  │
│  ├─ desktop/
│  │  ├─ build/
│  │  │  ├─ electron/             # product shell/build adapter
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
│  ├─ product/test/               # product composition contract tests
│  ├─ schemas/                    # product, artifact, release manifest schemas
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
│  │  ├─ product.js               # shared contract loader/resolver/stager
│  │  ├─ verify-product.sh        # generic pinned-product reachability guard
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
| `product/` | Pinned complete game repository and product-owned Drydock contract | Depend on a release channel or store |
| `runtime/` | Generic Drydock host runtime injected into composed products | Contain product presentation, gameplay, or engine-specific adapters |
| `platforms/*/iterate/<mode>/` | Fast feedback loops such as Caddy-backed web iteration | Emit release artifacts or read secrets |
| `platforms/*/build/<adapter>/` | Platform shell/compiler and artifact build adapter | Hard-code release channels or duplicate product-contract mappings |
| `platforms/*/channels/<channel>/` | Channel SDK integration, metadata, package/sign scripts, publish tooling | Reach into product internals without going through `drydock-artifact.json` |
| `platforms/mobile/native/{ios,android}/` | OS-native generated projects and durable native extension points | Hold App Store / Play release metadata directly |
| `contracts/host-bridge/` | Typed bridge API, error model, conformance tests | Contain platform SDK code |
| `contracts/schemas/` | Product, artifact, and release manifest schemas | Encode one product or engine's private paths |
| `contracts/fixtures/` | Small sample manifests for validation and docs | Become a second source of truth for real release outputs |
| `contracts/releases/` | Version/build/channel release manifests | Store credentials |
| `artifacts/` | Ignored build output, package output, smoke reports, and temporary staging | Store source, docs, contracts, credentials, or hand-edited release inputs |
| `tools/scripts/` | Repeatable helper scripts and validators | Hold channel-specific SDK integration or secrets |
| `tools/skills/` | Repo-local Codex skills and reusable agent workflows | Replace project docs or hide required release behavior |
| `docs/` | Architecture, workflow, release, and roadmap docs | Own executable release behavior |
| `.github/workflows/` | One workflow per release channel | Decrypt another channel's secrets |

## Invariants

- `product/` is a complete repository. Its engine dependencies are immaterial to
  Drydock.
- Product changes are committed and pushed in the product repository before Drydock
  records the new `product/` gitlink.
- Every target consumes `product/drydock-product.json`; runtime source mappings must not
  be reimplemented independently by adapters.
- Web iteration resolves the pinned `product/` checkout by default without copying or
  symlinking a second source mirror. `DRYDOCK_PRODUCT_ROOT` is an optional override.
- Public live iteration origins bind to `127.0.0.1` and rely on Caddy allowlists. They do
  not serve the repo root.
- Every build adapter emits `drydock-artifact.json` under `artifacts/build/<target>/` and
  validates it against `contracts/schemas/drydock-artifact.schema.json`.
- Channel tooling consumes the artifact manifest first. It must fail early if required
  fields or capabilities are missing.
- A new channel should add one `channels/<channel>/` folder and one workflow. Shared
  contract changes are allowed only when the existing artifact or host bridge contract
  cannot express a real requirement.
- A product requiring a native compiler/runtime that cannot use an existing shell adds one
  `build/<adapter>/` folder and must prove compatibility with at least one existing
  channel. A browser product may reuse the current web/Electron adapters through the
  product contract.
- SOPS encrypted files may be committed. Plaintext secrets, signing material, SDK caches,
  generated build outputs, and personal credentials are ignored.
