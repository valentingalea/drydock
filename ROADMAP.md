# Roadmap

Status: **planning / scaffold**. No build pipeline exists yet. The game is a placeholder
(minimal WebGL render) whose only job is to prove the pipeline end to end.

## Build order

Do these in sequence — each proves a layer the next depends on.

### 1. Payload + web run
- [ ] `game/index.html` renders a minimal WebGL scene (e.g. a spinning cube).
- [ ] Vendor the runtime dependency locally; no CDN references (offline-safe).
- [ ] `game/host-bridge.js` defines the Host interface with a no-op web implementation.
- [ ] Serve `game/` locally and confirm it runs.

### 2. Desktop shell (Electron), store-agnostic
- [ ] `platforms/desktop/build/electron/` with `main.js`, `preload.js`, `builder.base.yml`.
- [ ] Register an `app://` protocol serving `game/` (stable origin for ES modules / importmap).
- [ ] GPU flags (force high-performance GPU, verify hardware acceleration).
- [ ] `preload.js` implements the host bridge over IPC.
- [ ] Produce an unpacked build that launches the payload.

### 3. First store overlay — Steam
- [ ] `platforms/desktop/stores/steam/` with `host.js`, `metadata/`, `assets/`, depot `.vdf`.
- [ ] `STORE=steam` build wires the overlay into the shell.
- [ ] `publish.sh` uploads via `steamcmd`.
- [ ] `.github/workflows/steam.yml` (win + linux + mac matrix), tag-triggered.
- [ ] Prove the tag-push → CI → upload flow to a Steam private branch.

### 4. Mobile (Capacitor)
- [ ] `platforms/mobile/build/capacitor/` config with `webDir` → `game/`, host-bridge impl.
- [ ] Generate `ios/` and `android/` native projects.
- [ ] fastlane lanes: iOS `release`, Android `deploy`.
- [ ] `.github/workflows/ios.yml` (macOS) and `play.yml` (linux), tag-triggered.

### 5. Second desktop store — Epic
- [ ] `platforms/desktop/stores/epic/` proving the overlay pattern generalizes with zero
      changes outside the new folder + workflow.

### 6. Engine adapter — Unreal (validation)
- [ ] `platforms/desktop/build/unreal/` wrapping `RunUAT BuildCookRun`.
- [ ] Confirm every `stores/*` overlay and CI workflow is reused unchanged.

## Definition of done for the template

- One `pnpm run bump` + three tag pushes produce uploads to Steam, App Store, and Play.
- Adding a store touches exactly one `stores/` folder and one workflow.
- Swapping the payload (or the engine adapter) touches nothing in the store layer.
