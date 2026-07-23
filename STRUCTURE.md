# Structure

Root stays minimal. Everything platform-specific lives under `platforms/`.

```
drydock/
├─ game/                          # the portable payload — the ONE source of truth
│  ├─ index.html                  #   placeholder: minimal WebGL render
│  ├─ vendor/                     #   vendored runtime deps (offline-safe, no CDN)
│  └─ host-bridge.js              #   game ↔ host interface (see ARCHITECTURE.md)
│
├─ platforms/                     # all platform-specific code + config
│  │
│  ├─ desktop/                    # ══ Electron runtime family ══
│  │  ├─ build/
│  │  │  ├─ electron/             #   store-agnostic shell
│  │  │  │  ├─ package.json       #     electron + electron-builder only
│  │  │  │  ├─ main.js            #     app:// protocol, GPU flags, window, load store module
│  │  │  │  ├─ preload.js         #     implements host-bridge over IPC
│  │  │  │  └─ builder.base.yml   #     shared electron-builder config
│  │  │  └─ unreal/               #   (future) UE desktop build via RunUAT
│  │  └─ stores/
│  │     ├─ steam/
│  │     │  ├─ package.json       #     steamworks.js (store-only dep)
│  │     │  ├─ host.js            #     achievements / cloud saves / overlay impl
│  │     │  ├─ assets/            #     capsules, library art, screenshots
│  │     │  ├─ metadata/          #     store copy, achievement defs, depot .vdf (public IDs OK)
│  │     │  ├─ builder.steam.yml  #     overrides base (appId, artifact name)
│  │     │  ├─ secrets.example    #     required env var NAMES only (committed)
│  │     │  ├─ secrets.enc.yaml   #     SOPS+age encrypted values (committed, safe)
│  │     │  └─ publish.sh         #     steamcmd depot build + upload (reads env vars only)
│  │     ├─ epic/                 #   EOS SDK + BuildPatchTool, same shape
│  │     └─ gog/  itch/           #   optional, same shape
│  │
│  ├─ mobile/                     # ══ Capacitor runtime family ══
│  │  ├─ build/
│  │  │  └─ capacitor/
│  │  │     ├─ package.json       #     @capacitor/core + cli + plugins
│  │  │     ├─ capacitor.config.* #     webDir → ../../../../game
│  │  │     └─ host.ts            #     host-bridge via Capacitor plugins
│  │  ├─ ios/                     #   generated Xcode project → App Store
│  │  │  ├─ App/                  #     native project
│  │  │  ├─ fastlane/             #     App Store Connect metadata + upload lane
│  │  │  └─ Gemfile               #     ruby/fastlane deps (isolated)
│  │  └─ android/                 #   generated Gradle project → Play
│  │     ├─ app/
│  │     └─ fastlane/             #     Play Console metadata + upload lane
│  │
│  └─ shared/                     # cross-family native helpers (rare)
│
├─ tools/                         # vendor deps, sync payload, fetch SDKs, release helpers
├─ .sops.yaml                     # age recipients authorized to decrypt secrets (see SECRETS.md)
├─ .github/workflows/             # one pipeline per target (steam / epic / ios / play)
├─ AGENTS.md  ARCHITECTURE.md  STRUCTURE.md  TOOLCHAIN.md  RELEASE.md  ROADMAP.md
└─ package.json                   # pnpm workspace root (see TOOLCHAIN.md)
```

## Directory responsibilities

| Path | Owns | Must NOT |
|---|---|---|
| `game/` | The whole game + host-bridge calls | Reference any store or engine |
| `platforms/desktop/build/electron/` | Native windowing, GPU config, protocol, IPC | Know which store it's shipping to |
| `platforms/desktop/stores/<store>/` | One store's SDK, metadata, art, upload | Assume an engine |
| `platforms/mobile/build/capacitor/` | Web→native bridge config, plugins | Store metadata (lives in ios/android fastlane) |
| `platforms/mobile/{ios,android}/` | Generated native project + fastlane lane | Be hand-edited where `cap sync` regenerates |
| `tools/` | Repeatable scripts (vendor, sync, fetch-sdk, bump) | Hold secrets |
| `stores/<store>/secrets.*` | The env-var contract + encrypted values (see `SECRETS.md`) | Contain plaintext secrets |
| `.github/workflows/` | One workflow per store target | Cross-hold another target's secrets |

## Invariants

- `game/` exists exactly once. Every target consumes it by reference (Electron `app://`
  protocol, Capacitor `webDir`), never by copying a second canonical copy into the repo.
- A new store = a new `stores/<store>/` folder + a new `.github/workflows/<store>.yml`.
  Nothing else changes.
- A new engine = a new `build/<engine>/` folder. Store overlays and CI are untouched.
