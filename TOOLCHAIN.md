# Toolchain

## Rule: every folder owns its own dependency manifest

Nothing shares a `node_modules`. The Electron shell, each store overlay, and the Capacitor
shell each have their own `package.json` and their own isolated dependency tree, so one
family's dependencies can never contaminate another's.

## JavaScript side — pnpm workspaces via Corepack

- **Corepack pins the package manager per-repo.** The root `package.json` declares
  `"packageManager": "pnpm@<version>"`. No global install is required; every machine and CI
  runner uses the exact pinned version:
  ```
  corepack enable pnpm
  pnpm install
  ```
- **Workspaces link the payload in, keep trees isolated.** pnpm's content-addressed store
  keeps one physical copy of each dependency on disk and hard-links it into each package —
  so multiple heavy installs (Electron is ~150 MB+) cost the disk of roughly one, without
  merging the dependency graphs.
- **`game/` is a workspace package** so shells depend on it by reference; there is still
  exactly one copy of the game.
- Run a package's script with a filter:
  ```
  pnpm --filter @drydock/desktop-shell build:win
  ```

pnpm is a Node program and runs identically on Windows, macOS, and Linux.

## Native toolchains live outside the JS graph

Xcode, Gradle, CocoaPods (`Podfile`), and fastlane (`Gemfile`, Ruby) are per-project worlds
the JS package manager never sees. This is intended: an iOS signing problem cannot break the
Steam pipeline because they do not share a resolver.

| Target | Native toolchain(s) |
|---|---|
| Steam / Epic / GOG / itch | electron-builder; `steamcmd` / EOS BuildPatchTool for upload |
| App Store | Xcode + CocoaPods + fastlane (Ruby) |
| Google Play | Gradle + fastlane (Ruby) |

## SDKs — pin, don't vendor

- **Machine-level SDKs** (Android SDK/NDK, Xcode) are never committed. Each folder's README
  pins the required version; CI installs them on the matching runner.
- **Redistributable SDKs** (Steamworks redistributable, EOS SDK) are gitignored and fetched
  by a pinned `tools/fetch-sdk-<name>.sh` against a fixed version.
- **Signing keys & store credentials** live only as CI secrets (or an encrypted store such
  as fastlane `match`). Never in the repo, never in plaintext.

## CI — one workflow per target

Each store target has its own workflow, pinned to the correct runner OS and triggered by its
own tag / path filter, holding only that store's secrets:

| Workflow | Runner | Builds |
|---|---|---|
| `steam.yml` | windows + macos + linux (matrix) | Electron per-OS, upload via steamcmd |
| `epic.yml` | windows + macos | Electron per-OS, upload via BuildPatchTool |
| `ios.yml` | **macOS only** | Capacitor → Xcode, upload via fastlane |
| `play.yml` | linux | Capacitor → Gradle, upload via fastlane |

Hard constraint: iOS (and a signed/notarized macOS build) **requires a macOS runner**.
Everything else can build on Linux.
