# Architecture

## Three layers

The harness is three layers that change for different reasons and on different schedules.
Each knows nothing about the layers below it in the store direction.

```
  ┌───────────────────────────────────────────────┐
  │  GAME (payload)                                 │  never changes per platform
  │  calls the host bridge only                     │
  ├───────────────────────────────────────────────┤
  │  RUNTIME SHELL (build adapter)                  │  per engine/family, store-agnostic
  │  turns the payload into a native artifact       │
  ├───────────────────────────────────────────────┤
  │  STORE / CHANNEL                                │  per business deal
  │  SDK integration + metadata + upload tooling    │
  └───────────────────────────────────────────────┘
```

Natural asymmetry — do not force symmetry:

- **Desktop:** one runtime (Electron) → many stores (Steam / Epic / GOG / itch). The store
  is the fan-out axis.
- **Mobile:** one runtime (Capacitor) → two native projects (iOS / Android) → one dominant
  store each. The OS is the axis; store metadata rides *inside* each native project.

## The build/distribute seam

The single most important boundary (see `AGENTS.md`).

- **BUILD adapters** live under `platforms/<family>/build/<engine>/`. Each produces a
  per-platform artifact and nothing more. Swapping engines swaps only this folder.
- **STORE overlays** live under `platforms/desktop/stores/<store>/` (and inside the mobile
  native projects). Each consumes an artifact and publishes it. They are engine-agnostic.

An engine change (web → Unreal) replaces `build/*` and leaves every store overlay, CI
pipeline, and the release flow untouched.

## The host bridge

The seam that keeps the payload portable. The game calls a small, fixed interface; each
runtime shell *provides* the implementation. The game contains zero `if (store)` branches.

```
Host = {
  ready(): void                      // shell → game: environment is up
  save(key, value): Promise<void>    // local or cloud, decided by the shell
  load(key): Promise<any>
  telemetry(event): void             // no-op, HTTP, or store analytics
  achievement(id): void              // no-op on web; Steam/Game Center/Play elsewhere
  purchase(sku): Promise<Result>     // IAP; no-op where not applicable
}
```

Implementations:

| Runtime | How the bridge is provided |
|---|---|
| Web (dev / itch web) | Thin no-op / `localStorage` / HTTP shim |
| Electron | `preload.js` exposes IPC; store overlay supplies save/achievement/IAP |
| Capacitor | Capacitor plugins (Preferences, Game Center, Play Games, Billing) |

This is also how environment-specific concerns (e.g. telemetry endpoints that exist only on
the web build) are gated: the game calls `Host.telemetry(...)`; the shell decides whether
that does anything.

## Composing a shell with a store (desktop)

The Electron shell is store-agnostic. A build selects a store overlay at build time:

```
STORE=steam  →  shell loads stores/steam/host.js  +  merges builder.steam.yml over builder.base.yml
```

Same Electron binary, different SDK + metadata + artifact name. Steam knows nothing about
Epic and vice versa; the shell knows nothing about either.

## Engine-agnostic by design

Because the store layer consumes artifacts, not engines, the same harness serves:

- **Web games** — `build/electron`, `build/capacitor`.
- **Unreal games** — `build/unreal` (a thin wrapper around `RunUAT BuildCookRun`). Unreal
  compiles native binaries directly, so it *replaces* the Electron/Capacitor shell rather
  than sitting inside one. Store SDK integration moves into engine plugins
  (`OnlineSubsystemSteam`, `OnlineSubsystemEOS`), but store metadata, art, depot scripts,
  upload tooling, and CI are reused unchanged.
- **Consoles** — reachable for engines with native console targets. Add `stores/<console>/`
  overlays alongside the desktop ones; the same publish/CI pattern applies.
