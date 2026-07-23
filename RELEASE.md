# Release

Mental model: **one-time setup per store** (accounts, signing, SDKs) then a **repeatable
release flow**. The commands below assume the one-time setup is done.

## Build/host OS matrix

| Build | Can build on |
|---|---|
| Steam / Epic — Windows + Linux binaries | any OS |
| Steam / Epic — macOS binary (signed + notarized) | macOS only |
| iOS | macOS only (Xcode) |
| Android | any OS |

## Versioning — single source of truth

One version value drives every manifest. Bump it once:

```
pnpm run bump 1.4.0     # writes version into every platform manifest
```

## Shared prep (any machine, per release)

```
corepack enable pnpm
pnpm install
pnpm run vendor          # ensure runtime deps are vendored locally (offline-safe)
pnpm run bump <version>
```

There is no bundler step for the web payload — the "web build" is `game/` with its runtime
vendored. Every target consumes that same folder.

---

## Steam

**One-time:** Steamworks partner account; create the app → obtain AppID + depot IDs; install
`steamcmd`; add `steamworks.js` to `platforms/desktop/stores/steam`; write depot scripts
(`app_build_<AppID>.vdf`, `depot_build_*.vdf`) into `stores/steam/metadata/`.

**Per release:**
```
# Build the desktop app with the Steam overlay, per OS.
STORE=steam pnpm --filter @drydock/desktop-shell build:win
STORE=steam pnpm --filter @drydock/desktop-shell build:linux
STORE=steam pnpm --filter @drydock/desktop-shell build:mac     # needs macOS + notarization

# Push all depots in one shot.
steamcmd +login <builder_acct> \
  +run_app_build "$PWD/platforms/desktop/stores/steam/metadata/app_build_<AppID>.vdf" \
  +quit
```
Final step is manual: set the build live on its branch in the Steamworks dashboard. First
release also needs the store page filled and a one-time Valve content review. No per-build
review after go-live.

---

## iOS → App Store

**One-time (macOS):** Apple Developer Program; create the app record in App Store Connect;
signing certs + provisioning (prefer fastlane `match`); `bundle install` the `Gemfile` in
`platforms/mobile/ios`.

**Per release:**
```
pnpm --filter @drydock/mobile-shell exec cap sync ios     # push web build into native project
cd platforms/mobile/ios
bundle exec fastlane release
#   lane: increment_build_number → gym (archive+sign .ipa) → pilot (upload to App Store Connect)
```
Then submit for review (or `deliver --submit_for_review`) and wait for Apple review.
TestFlight internal builds skip full review — use them for the fast smoke-test loop.

---

## Android → Google Play

**One-time:** Play Console account; create the app; generate an upload keystore and enrol in
Play App Signing; create a Google Cloud service-account JSON for headless upload;
`bundle install` the `Gemfile` in `platforms/mobile/android`.

**Per release:**
```
pnpm --filter @drydock/mobile-shell exec cap sync android
cd platforms/mobile/android
bundle exec fastlane deploy
#   lane: gradle bundleRelease (signed .aab) → supply (upload to 'internal' track)
```
Promote internal → closed → production in Play Console (or `supply --track production`).
First release needs the store listing + content-rating questionnaire once.

---

## Release day (CI-driven)

The macOS constraint means releases are tag-triggered rather than run by hand. Each target
has its own workflow on the right runner with only its own secrets.

```
pnpm run bump 1.4.0
git commit -am "release 1.4.0"

git tag steam-v1.4.0 && git push origin steam-v1.4.0    # → steam.yml (win+linux+mac)
git tag ios-v1.4.0   && git push origin ios-v1.4.0      # → ios.yml   (macOS runner)
git tag play-v1.4.0  && git push origin play-v1.4.0      # → play.yml  (linux runner)
```

Each pipeline checks out, `pnpm install`, builds only its target, and uploads with that
store's secrets. The only remaining manual step is the "go live / submit" button in each
store dashboard — deliberately un-automated because it is the legal act of publishing.

## Unreal note

For an Unreal payload the per-store flow above is unchanged; only the build step differs:
`build/unreal` invokes `RunUAT BuildCookRun` to produce the per-platform artifact, which the
same `stores/*` overlays and CI workflows then publish. Store SDK integration lives in engine
plugins rather than the shell. See `ARCHITECTURE.md`.
