# Drydock

A reusable harness for shipping one game to many release channels: Steam, Epic, GOG,
itch, the App Store, and Google Play. The goal is to keep game code portable while
making each channel's build, signing, metadata, and upload rules explicit.

The complete game repository is treated as an interchangeable **product**: the vessel
that Drydock prepares for release. The current proof product is Line Engine's canonical
calibration client, pinned as the root `product/` git submodule. The product owns
`drydock-product.json`, its engine dependencies, and its Drydock host adapter. Drydock
does not maintain game code or infer product internals.

## Core principle - the release pipeline

Do not collapse engine build work and channel release work into one script. A release
passes through four stages:

```
BUILD  ->  INTEGRATE  ->  PACKAGE / SIGN  ->  PUBLISH
```

- **BUILD** is product/build-adapter-specific. It stages, compiles, or wraps the product
  into a raw artifact and writes a `drydock-artifact.json` manifest describing it.
- **INTEGRATE** is channel-specific runtime work. It wires in store SDKs, overlays,
  entitlement checks, achievement providers, cloud-save providers, and other channel
  capabilities.
- **PACKAGE / SIGN** creates the channel-ready binary or depot: signed/notarized desktop
  app, Steam depot layout, `.ipa`, `.aab`, etc.
- **PUBLISH** uploads or promotes that packaged output with the channel's own tooling.

The boundary is not "stores never affect binaries." Real stores often do. The boundary is
that channel-specific behavior is isolated behind a documented artifact manifest and host
bridge instead of leaking into the product.

Fast iteration is separate from release. By default, web iteration resolves
contract-selected files directly from the pinned `product/` checkout through a
localhost-only origin and Caddy allowlist. An optional `DRYDOCK_PRODUCT_ROOT` override
may select another checkout, but neither iteration mode emits an artifact or participates
in release verification. Release builds always consume the pinned `product/` gitlink.

## Documentation map

Read in this order.

| File | Purpose |
|---|---|
| `docs/ARCHITECTURE.md` | The layered model, release stages, artifact manifest, host bridge. Read first. |
| `docs/PRODUCT.md` | Canonical product ownership, contract, external iteration, pinning, and substitution workflow. |
| `docs/STRUCTURE.md` | Canonical folder tree and what each directory owns. |
| `docs/TOOLCHAIN.md` | Package management, dependency isolation, SDK & signing handling. |
| `docs/ITERATE.md` | The fast Caddy-backed web iteration path and its safety rules. |
| `docs/SECRETS.md` | SOPS+age secrets workflow and how secrets reach the packager. |
| `docs/RELEASE.md` | Per-channel setup, repeatable release flow, versioning, CI. |
| `docs/ROADMAP.md` | Current status and the order to build things in. |
| `tools/skills/playwright-web-smoke/SKILL.md` | Repo-local Playwright workflow for blank-page and route diagnostics. |

## Ground rules for contributors

1. **The product never references a channel or store.** It owns its engine/runtime
   dependencies and accesses platform services only through the host bridge.
2. **Every repository and Drydock package owns its dependency graph.** The product keeps
   its own dependencies; every Drydock platform/channel package keeps its own manifest.
   Nothing relies on a shared `node_modules`.
3. **Every build adapter emits `drydock-artifact.json`.** Channel tooling consumes the
   manifest, not engine-specific paths.
4. **Adding a channel should add a channel folder + workflow.** If shared code changes,
   it should be because the artifact or host contract was missing a real capability.
5. **Iteration paths are not release paths.** `platforms/web/iterate/caddy-live/` may
   compose live allowlisted product files for speed, but release channels consume
   packaged artifacts.
6. **The product owns its entire composition.** `product/drydock-product.json` names
   product-relative sources and runtime targets. Drydock supplies only its host runtime
   and must not own product-specific overlays.
7. **Product and harness changes are separate commits.** Push a reachable product
   commit/tag first, then commit the updated `product/` gitlink in Drydock.
8. **Secrets use SOPS+age by default.** Encrypted files may be committed; plaintext keys,
   signing material, SDK caches, and personal credentials never enter the repo.
9. Prefer conventional tools (pnpm, electron-builder, fastlane, steamcmd) over bespoke
   scripting, so any agent or engineer can pick the work up cold.
10. **Committed material is portable.** Documentation, examples, templates, fixtures,
    and comments use repository-relative commands, configurable values, or generic
    placeholders. They never encode a contributor's checkout layout, username, private
    hostname, deployment domain, or one-off machine configuration.
