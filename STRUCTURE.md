# Structure

Root stays minimal. Portable game code, shared contracts, build adapters, release
channels, and tooling live in separate folders.

```
drydock/
├─ game/                          # portable payload - the one source of truth
│  ├─ index.html                  # placeholder: minimal WebGL render
│  ├─ package.json
│  ├─ src/
│  ├─ test/
│  ├─ vendor/                     # vendored runtime deps, offline-safe
│  └─ host-bridge.js              # payload-facing bridge shim
│
├─ packages/
│  └─ host-bridge/                # typed host API + conformance tests
│     ├─ package.json
│     ├─ src/
│     └─ test/
│
├─ schemas/
│  ├─ drydock-artifact.schema.json # validates build adapter output
│  └─ release-manifest.schema.json # validates release manifests
│
├─ fixtures/
│  └─ artifacts/                   # valid/invalid manifest examples for tests and docs
│
├─ platforms/
│  ├─ web/
│  │  ├─ iterate/
│  │  │  └─ caddy-live/           # live game/ origin for immediate browser feedback
│  │  │     ├─ package.json
│  │  │     ├─ server.js
│  │  │     ├─ start.sh
│  │  │     ├─ caddy.example
│  │  │     ├─ caddy.path.example
│  │  │     └─ test/
│  │  ├─ build/
│  │  │  └─ static/               # copy runtime files into out/web-static/
│  │  │     ├─ package.json
│  │  │     ├─ build.js
│  │  │     └─ test/
│  │  └─ channels/
│  │     └─ vps/                  # deploy packaged web artifact through Caddy
│  │        ├─ package.json
│  │        ├─ publish.js
│  │        ├─ caddy.example
│  │        ├─ caddy.path.example
│  │        └─ test/
│  │
│  ├─ desktop/
│  │  ├─ build/
│  │  │  ├─ electron/             # engine/runtime build adapter
│  │  │  │  ├─ package.json       # electron + electron-builder only
│  │  │  │  ├─ main.js            # app:// protocol, GPU config, window setup
│  │  │  │  ├─ preload.js         # typed host bridge over validated IPC
│  │  │  │  └─ builder.base.yml   # shared electron-builder config
│  │  │  └─ unreal/               # future UE desktop build via RunUAT
│  │  └─ channels/
│  │     ├─ steam/
│  │     │  ├─ package.json       # steam channel-only deps
│  │     │  ├─ integrate.sh       # SDK/redistributable/runtime integration
│  │     │  ├─ package.sh         # depot layout, signing inputs, checksums
│  │     │  ├─ publish.sh         # steamcmd upload; reads env vars only
│  │     │  ├─ host.js            # Steam host-bridge provider
│  │     │  ├─ assets/            # capsules, library art, screenshots
│  │     │  ├─ metadata/          # store copy, achievement defs, depot .vdf
│  │     │  ├─ builder.steam.yml  # Electron packaging overrides
│  │     │  ├─ secrets.example    # required env var names only
│  │     │  └─ secrets.enc.yaml   # SOPS+age encrypted values
│  │     ├─ epic/
│  │     ├─ gog/
│  │     └─ itch/
│  │
│  └─ mobile/
│     ├─ build/
│     │  └─ capacitor/
│     │     ├─ package.json       # @capacitor/core + cli + plugins
│     │     ├─ capacitor.config.* # webDir -> game/
│     │     └─ host.ts            # base bridge via Capacitor plugins
│     ├─ native/
│     │  ├─ ios/                  # generated Xcode project and native extensions
│     │  │  ├─ App/
│     │  │  └─ Gemfile            # Ruby deps needed by native/channel tooling
│     │  └─ android/              # generated Gradle project and native extensions
│     │     └─ app/
│     └─ channels/
│        ├─ appstore/
│        │  ├─ fastlane/          # App Store metadata + upload lane
│        │  ├─ metadata/
│        │  ├─ assets/
│        │  ├─ package.sh
│        │  ├─ publish.sh
│        │  ├─ secrets.example
│        │  └─ secrets.enc.yaml
│        └─ play/
│           ├─ fastlane/          # Play metadata + upload lane
│           ├─ metadata/
│           ├─ assets/
│           ├─ package.sh
│           ├─ publish.sh
│           ├─ secrets.example
│           └─ secrets.enc.yaml
│
├─ tools/                         # validators, vendor deps, fetch SDKs, release helpers
│  ├─ validate-artifact.js
│  ├─ validate-release.js
│  └─ vendor-host-bridge.js
├─ skills/                        # repo-local Codex skills for future agents
│  └─ playwright-web-smoke/
│     ├─ SKILL.md
│     └─ scripts/
├─ releases/                      # release manifests, one file per release/candidate
├─ .sops.yaml                     # age recipients authorized to decrypt SOPS files
├─ .github/workflows/             # one pipeline per release channel
├─ package.json
├─ pnpm-workspace.yaml
├─ AGENTS.md
├─ ARCHITECTURE.md
├─ ITERATE.md
├─ TOOLCHAIN.md
├─ SECRETS.md
├─ RELEASE.md
└─ ROADMAP.md
```

## Directory Responsibilities

| Path | Owns | Must not |
|---|---|---|
| `game/` | The whole payload + host bridge calls | Reference any channel, store, or engine |
| `packages/host-bridge/` | Typed bridge API, error model, conformance tests | Contain platform SDK code |
| `schemas/` | Artifact and release manifest schemas | Encode one engine's private paths as required fields |
| `fixtures/` | Small sample manifests for validation and docs | Become a second source of truth for real release outputs |
| `platforms/*/iterate/<mode>/` | Fast feedback loops such as Caddy-backed web iteration | Emit release artifacts or read secrets |
| `platforms/*/build/<engine>/` | Engine/runtime build adapter | Hard-code release channels |
| `platforms/*/channels/<channel>/` | Channel SDK integration, metadata, package/sign scripts, publish tooling | Reach into engine internals without going through `drydock-artifact.json` |
| `platforms/mobile/native/{ios,android}/` | OS-native generated projects and durable native extension points | Hold App Store / Play release metadata directly |
| `tools/` | Repeatable helper scripts and validators | Hold secrets |
| `skills/` | Repo-local Codex skills and reusable agent workflows | Replace project docs or hide required release behavior |
| `releases/` | Version/build/channel release manifests | Store credentials |
| `.github/workflows/` | One workflow per release channel | Decrypt another channel's secrets |

## Invariants

- `game/` exists exactly once. Every target consumes it by reference or generated runtime
  copy; the repo never gains a second canonical copy of the payload.
- Web iteration serves `game/` directly as the document root. It must not duplicate the
  source tree or symlink a second source mirror.
- Public live iteration origins bind to `127.0.0.1` and rely on Caddy allowlists. They do
  not serve the repo root.
- Every build adapter emits `drydock-artifact.json` and validates it against the schema.
- Channel tooling consumes the artifact manifest first. It must fail early if required
  fields or capabilities are missing.
- A new channel should add one `channels/<channel>/` folder and one workflow. Shared
  contract changes are allowed only when the existing artifact or host bridge contract
  cannot express a real requirement.
- A new engine adds one `build/<engine>/` folder and must prove compatibility with at
  least one existing channel.
- SOPS encrypted files may be committed. Plaintext secrets, signing material, SDK caches,
  generated build outputs, and personal credentials are ignored.
