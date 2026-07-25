# Line Engine Payload

Line Engine is Drydock's underlying JavaScript game runtime. Its calibration client is
also the one canonical proof game used to exercise Drydock. The repositories remain
separate so the engine can evolve independently and each Drydock commit can name the
exact engine revision it ships.

This document is the contract for embedding, updating, composing, and verifying that
payload.

## Ownership

| Owner | Owns |
|---|---|
| Line Engine repository | `mock-game/`, engine source and styles, Three.js r160, the standalone development host, and engine tests |
| Drydock repository | The `engine/` gitlink, payload descriptor and launcher, protocol-v1 host bridge and overlay, platform shells, artifacts, and release channels |

There is no Drydock mock-game fork. Gameplay, calibration UI, rendering behavior, and
engine runtime fixes belong in Line Engine. Drydock may replace only Line Engine's
documented `mock-game/src/platform-host.js` extension point when it composes the payload.

## Checkout And Setup

Clone both repositories in one operation:

```sh
git clone --recurse-submodules https://github.com/valentingalea/Drydock.git
cd Drydock
npm install --global pnpm@11.17.0
pnpm install
pnpm run vendor
pnpm run validate
```

On Node distributions that include Corepack, `corepack enable pnpm` may be used instead.
The current VPS Node 25 installation does not include Corepack, so it needs the exact
globally installed pnpm version shown above.

For an existing Drydock checkout:

```sh
git submodule update --init --recursive
```

`engine/` is pinned through `.gitmodules` to
`https://github.com/valentingalea/Line-Engine.git`. Drydock currently records Line Engine
release `v0.0.0`, commit `fb962943c58bb909c3223670a49622c0d6acd39a`, and Three.js
revision `r160`.

## Composition Contract

[`game/drydock-payload.json`](../game/drydock-payload.json) is the only source-to-runtime
composition contract. It declares:

- product identity (`gameId`, names, application ID);
- the browser entrypoint;
- the Line Engine path, release name, and Three.js revision;
- source directories or files and their runtime targets;
- explicit overlays, currently only the Drydock platform host.

Every Drydock target consumes this descriptor through
[`tools/scripts/payload.js`](../tools/scripts/payload.js). An adapter must not maintain a
parallel file list or infer files by walking the submodule.

The composed URL tree is:

```text
/
├─ index.html                              # Drydock launcher
├─ host-bridge.js                          # Drydock host selection
├─ vendor/drydock-host-bridge/             # vendored shared contract
└─ engine/
   ├─ mock-game/
   │  ├─ index.html
   │  ├─ src/
   │  │  └─ platform-host.js               # Drydock overlay at Line's extension point
   │  └─ style/
   ├─ src/
   ├─ style/
   └─ lib/                                 # Line-owned Three.js r160
```

Descriptor entries are applied in order. Overlay entries intentionally replace an
earlier target; request resolution reads them in reverse order so the same rule works
without copying during live iteration. Packaged builds stage the entries into a clean
artifact root.

## Host Bridge Contract

Line Engine imports `connectPlatformHost()` from
`mock-game/src/platform-host.js`. That module has two implementations:

- Line Engine's checked-in implementation keeps the mock runnable by itself.
- Drydock's `game/overlays/platform-host.js` is served or staged at the same runtime URL
  and connects the mock to Drydock's host bridge.

The Drydock bridge negotiates protocol version 1. In a web browser it provides honest
local storage backed by `localStorage` (with an in-memory fallback). In Electron,
`preload.js` injects a validated `globalThis.drydockHost`, so the same payload uses the
shell's file-backed storage over the restricted IPC bridge. Future channel providers may
add capabilities, but Line Engine must never import channel SDKs or branch on store
names.

The bridge contract and conformance tests live in `contracts/host-bridge/`. Line Engine's
extension point and its default host live in the Line Engine repository.

## Iteration And Build

The descriptor has two consumers with intentionally different guarantees:

| Flow | Reads | Behavior | Output |
|---|---|---|---|
| Web iteration | Live `game/` files and the current `engine/` checkout | Resolves allowlisted requests directly; refresh shows edits | No artifact |
| Static web / Electron build | Exact Drydock commit, gitlink, descriptor, and release manifest | Strictly verifies the submodule and stages selected files | Artifact plus `drydock-artifact.json` |

Start the live path:

```sh
pnpm --filter @drydock/web-iterate-caddy-live serve -- --port 8090
```

The iteration server warns when the submodule is dirty or does not match Drydock's
gitlink. That is useful while changing both repositories, but it is not release evidence.
Build commands use strict verification and fail when the submodule is dirty, uninitialized,
not at the exact gitlink, or the pinned commit is not reachable from Line Engine's origin.

Static and Electron manifests record the payload descriptor plus
`extensions.drydock.engineRevision`: Line Engine name, submodule path, release, commit,
remote, and Three.js revision. Channels consume the manifest and artifact, never the
submodule.

## Updating Line Engine

Make engine behavior changes inside the submodule and validate them there:

```sh
cd engine
git switch main
git pull --ff-only
npm ci
npx playwright install chromium

# edit Line Engine files
tools/test.sh
git add <engine-files>
git commit -m "<Line Engine change>"
git push origin main
```

Create and push a release tag when Drydock is adopting a new named Line Engine release:

```sh
git tag -a vX.Y.Z -m "Line Engine vX.Y.Z"
git push origin vX.Y.Z
```

Then return to Drydock, update `game/drydock-payload.json` when the release name,
composition, or owned dependency revision changed, and record the new gitlink:

```sh
cd ..
git add engine game/drydock-payload.json
pnpm run validate:submodule
pnpm test
pnpm run validate
git commit -m "Embed Line Engine vX.Y.Z"
git push origin main
```

These are two separate commits in two repositories. Push the Line Engine commit or tag
before committing the Drydock gitlink so every collaborator and build runner can fetch
it. Never use a dirty submodule as a release input, and never commit a Drydock gitlink to
an engine commit that exists only locally.

After switching Drydock branches or pulling a gitlink change, synchronize the checkout:

```sh
git submodule update --init --recursive
```

## Changing The Composition

When Line Engine adds a runtime file or directory:

1. Add the narrowest required source-to-target entry to
   `game/drydock-payload.json`.
2. Update the Caddy live and packaged allowlists only if the new URL prefix is not
   already covered.
3. Keep repository metadata, tests, docs, and package files outside the descriptor.
4. Build both static web and Electron to prove that both consumers stage the same
   runtime.

If the host interface needs a new capability, change the shared host-bridge contract and
its conformance tests first, then implement it in Line Engine's extension usage and the
relevant Drydock providers. Do not solve a host capability by copying mock code or
importing a channel package into Line Engine.

## Verification

Before committing a Drydock engine-pin change:

```sh
pnpm run validate:submodule
pnpm test
pnpm run validate
pnpm --filter @drydock/web-static build -- \
  --release contracts/releases/0.1.0.yaml
```

For browser verification, both the live and packaged routes must load the calibration
menu, display `host v1`, transition to `data-line-state="play"` after Play is selected,
render one canvas, and report no page, console, or request errors.

Current proof routes:

- Live descriptor composition:
  `https://vinyltin.duckdns.org/drydock/`
- Packaged static composition:
  `https://vinyltin.duckdns.org/drydock-release/`
- Windows x64 Electron package:
  `https://vinyltin.duckdns.org/drydock-downloads/line-engine-calibration-0.1.0-windows-x64.zip`
