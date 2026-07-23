# Drydock

A reusable, engine-agnostic harness for shipping a single game to many storefronts —
Steam, Epic, GOG, itch (desktop) and the App Store / Google Play (mobile), with a clear
path to consoles. One housing; drop a game in, fan it out to every store.

The game itself is treated as an interchangeable **payload**. This repo ships with a
minimal placeholder payload (an empty WebGL render) so the pipeline can be proven end to
end before a real game exists.

## Core principle — the build/distribute seam

Everything hinges on one split:

```
   BUILD  (engine-specific)            │          DISTRIBUTE  (engine-agnostic)
   produce a per-platform artifact ───►│───►  wrap it + upload it to a storefront
```

- **BUILD** turns the game into a native artifact (a folder, `.app`, `.ipa`, `.aab`).
  The adapter is engine-specific: Electron/Capacitor for a web game, Unreal's UAT for an
  Unreal game, etc.
- **DISTRIBUTE** takes *any* artifact and publishes it. Storefronts do not care what
  produced the binary, so this half is reused unchanged across engines, games, and stores.

Keep this seam clean and the harness stays universal. Violate it (game code that knows
about a store, a store overlay that assumes an engine) and it rots.

## Documentation map

Read in this order.

| File | Purpose |
|---|---|
| `ARCHITECTURE.md` | The layered model, the build/distribute seam, the host bridge. Read first. |
| `STRUCTURE.md` | Canonical folder tree and what each directory owns. |
| `TOOLCHAIN.md` | Package management, dependency isolation, SDK & signing handling. |
| `RELEASE.md` | Per-store setup, the repeatable release flow, versioning, CI. |
| `ROADMAP.md` | Current status and the order to build things in. |

## Ground rules for contributors

1. **The payload never references a store or an engine.** It calls the host bridge only.
2. **Every platform folder owns its own dependency manifest.** Nothing shares `node_modules`.
3. **Adding a store is one new folder + one CI workflow.** If it touches anything else, the
   seam is wrong — fix the seam, not the store.
4. **Secrets and heavy SDKs never enter the repo.** Pin versions; fetch on demand; inject
   credentials from CI.
5. Prefer conventional tools (pnpm, electron-builder, fastlane, steamcmd) over bespoke
   scripting, so any agent or engineer can pick the work up cold.
