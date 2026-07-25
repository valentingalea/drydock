# Drydock

Proof-of-concept scaffold for a product-agnostic, channel-isolated game release harness.

The goal is to ship one portable product to many release channels - Steam, Epic, GOG,
itch, the App Store, and Google Play - without letting store logic leak into game code.
It also keeps fast web iteration separate from reproducible releases.

The current proof product is Line Engine's canonical calibration client. Drydock pins the
complete product repository at `product/`, reads its `drydock-product.json` contract, and
uses the same composition for live web iteration, packaged web releases, and Electron
builds. A future game can replace the product while owning Line Engine internally.

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

Initialize the product in an existing checkout with:

```sh
git submodule update --init --recursive
```

Current proof routes:

- Live product iteration: `https://vinyltin.duckdns.org/drydock/`
- Packaged static build: `https://vinyltin.duckdns.org/drydock-release/`
- Desktop downloads: `https://vinyltin.duckdns.org/drydock-downloads/`

Start with [`AGENTS.md`](./AGENTS.md) for the project rules and documentation map. Read
[`docs/PRODUCT.md`](./docs/PRODUCT.md) before changing the product pin, runtime mapping,
external iteration checkout, or host integration.
