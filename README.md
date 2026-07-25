# Drydock

Proof-of-concept scaffold for an engine-aware, channel-isolated game release harness.

The goal is to ship one portable payload to many release channels - Steam, Epic, GOG,
itch, the App Store, and Google Play - without letting store logic leak into game code.
It also keeps fast web iteration separate from reproducible releases.

The deployed proof payload is Line Engine's canonical calibration client. Drydock pins it
at `engine/`, composes it with the protocol-v1 host bridge, and uses that one composition
for live web iteration, packaged web releases, and Electron builds.

```sh
git clone --recurse-submodules https://github.com/valentingalea/Drydock.git
cd Drydock
npm install --global pnpm@11.17.0
pnpm install
pnpm run vendor
pnpm run validate
```

If the Node distribution includes Corepack, `corepack enable pnpm` may replace the global
install; the root `packageManager` field pins the same pnpm version. The current VPS
Node 25 installation does not include Corepack.

Initialize the engine in an existing checkout with:

```sh
git submodule update --init --recursive
```

Current proof routes:

- Live Line Engine iteration: `https://vinyltin.duckdns.org/drydock/`
- Packaged static build: `https://vinyltin.duckdns.org/drydock-release/`
- Desktop downloads: `https://vinyltin.duckdns.org/drydock-downloads/`

Start with [`AGENTS.md`](./AGENTS.md) for the project rules and documentation map. Read
[`docs/PAYLOAD.md`](./docs/PAYLOAD.md) before changing the Line Engine pin, runtime file
mapping, or host integration.
