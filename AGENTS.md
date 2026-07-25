# Drydock

A reusable harness for shipping one game to many release channels: Steam, Epic, GOG,
itch, the App Store, and Google Play. The goal is to keep game code portable while
making each channel's build, signing, metadata, and upload rules explicit.

The game itself is treated as an interchangeable **payload**. The current proof payload
is Line Engine's canonical calibration mock, pinned as the root `engine/` git submodule.
`game/drydock-payload.json` composes that source with Drydock's host adapter; Drydock does
not maintain a second mock game.

## Core principle - the release pipeline

Do not collapse engine build work and channel release work into one script. A release
passes through four stages:

```
BUILD  ->  INTEGRATE  ->  PACKAGE / SIGN  ->  PUBLISH
```

- **BUILD** is engine-specific. It turns the payload into a raw native artifact and writes
  a `drydock-artifact.json` manifest describing the output.
- **INTEGRATE** is channel-specific runtime work. It wires in store SDKs, overlays,
  entitlement checks, achievement providers, cloud-save providers, and other channel
  capabilities.
- **PACKAGE / SIGN** creates the channel-ready binary or depot: signed/notarized desktop
  app, Steam depot layout, `.ipa`, `.aab`, etc.
- **PUBLISH** uploads or promotes that packaged output with the channel's own tooling.

The boundary is not "stores never affect binaries." Real stores often do. The boundary is
that channel-specific behavior is isolated behind a documented artifact manifest and host
bridge instead of leaking into the payload.

Fast iteration is separate from release. Web iteration may serve the descriptor-selected
files from `game/` and `engine/` directly through a localhost-only origin and Caddy
allowlist, but that path does not emit an artifact and is not used for release
verification.

## Documentation map

Read in this order.

| File | Purpose |
|---|---|
| `docs/ARCHITECTURE.md` | The layered model, release stages, artifact manifest, host bridge. Read first. |
| `docs/STRUCTURE.md` | Canonical folder tree and what each directory owns. |
| `docs/TOOLCHAIN.md` | Package management, dependency isolation, SDK & signing handling. |
| `docs/ITERATE.md` | The fast Caddy-backed web iteration path and its safety rules. |
| `docs/SECRETS.md` | SOPS+age secrets workflow and how secrets reach the packager. |
| `docs/RELEASE.md` | Per-channel setup, repeatable release flow, versioning, CI. |
| `docs/ROADMAP.md` | Current status and the order to build things in. |
| `tools/skills/playwright-web-smoke/SKILL.md` | Repo-local Playwright workflow for blank-page and route diagnostics. |

## Ground rules for contributors

1. **The payload never references a channel or store.** Payload runtime dependencies such
   as Line Engine are explicit and pinned; platform services are accessed only through
   the host bridge.
2. **Every platform or channel package owns its own dependency manifest.** Nothing relies
   on a shared `node_modules`.
3. **Every build adapter emits `drydock-artifact.json`.** Channel tooling consumes the
   manifest, not engine-specific paths.
4. **Adding a channel should add a channel folder + workflow.** If shared code changes,
   it should be because the artifact or host contract was missing a real capability.
5. **Iteration paths are not release paths.** `platforms/web/iterate/caddy-live/` may
   compose live allowlisted payload files for speed, but release channels consume
   packaged artifacts.
6. **Line Engine's `mock-game/` is the only mock game.** Drydock may overlay its documented
   `platform-host.js` extension point, but must not copy or fork the mock.
7. **Secrets use SOPS+age by default.** Encrypted files may be committed; plaintext keys,
   signing material, SDK caches, and personal credentials never enter the repo.
8. Prefer conventional tools (pnpm, electron-builder, fastlane, steamcmd) over bespoke
   scripting, so any agent or engineer can pick the work up cold.
