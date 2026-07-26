# Product Contract

The **product** is the complete game repository that Drydock iterates, builds, and
releases. In the Drydock metaphor it is the vessel; Drydock is the machinery that
prepares that vessel for different launch channels.

Drydock must not know which engine, framework, or internal repository layout the product
uses. Today `product/` points to Line Engine because its calibration client is the proof
product. A future game repository can replace it while owning Line Engine internally.

## Ownership

| Owner | Owns |
|---|---|
| Product repository | Game and engine code, product identity, runtime source mappings, entrypoint, and product-side Drydock host adapter |
| Drydock repository | Product contract schema, protocol-v1 host runtime, build adapters, artifact manifests, release channels, signing, and publishing |

The product may call Drydock's versioned host bridge. It must not import a release
channel, store SDK, signing tool, or publisher. Drydock may stage only files named by the
product contract and must not infer product internals.

## Checkout

`product/` is a pinned git submodule:

```sh
git clone --recurse-submodules https://github.com/valentingalea/Drydock.git
cd Drydock
npm install --global pnpm@11.17.0
pnpm install
pnpm run vendor
pnpm run validate
```

For an existing checkout:

```sh
git submodule update --init --recursive
```

The current proof product is Line Engine release `v0.0.1`, commit
`52e9ec6a8feb51200a268754a8f08d8777a0992e`.

## Product-Owned Contract

Every product repository exposes `drydock-product.json` at its root. Drydock validates it
against `contracts/schemas/drydock-product.schema.json`.

The contract declares:

- stable product identity and application names;
- the runtime entrypoint;
- product-relative source files or directories;
- their targets in the composed runtime;
- any product-owned adapter that intentionally overlays another product target.

Sources are always relative to the selected product repository. Targets are either the
root `index.html` launcher or live under `product/`. Product entries cannot overwrite
Drydock's reserved host runtime.

The current contract produces:

```text
/
├─ index.html                              # product-owned launcher
├─ host-bridge.js                          # Drydock-owned web host runtime
├─ vendor/drydock-host-bridge/             # Drydock-owned contract runtime
└─ product/
   ├─ mock-game/
   │  ├─ index.html
   │  ├─ src/
   │  │  └─ platform-host.js               # product-owned Drydock adapter
   │  └─ style/
   ├─ src/
   ├─ style/
   └─ lib/
```

`tools/scripts/product.js` is the only composition implementation. Live iteration
resolves requests through it; static web and Electron stage through it. Adapters must not
maintain parallel source lists.

## Host Boundary

Drydock supplies `runtime/web/host-bridge.js` and the vendored protocol implementation.
The product supplies the code that connects its own runtime to that bridge.

For the proof product, Line Engine owns
`integrations/drydock/platform-host.js`. Its product contract stages that file at Line
Engine's documented `mock-game/src/platform-host.js` extension point. Drydock contains no
Line-specific overlay.

In a browser, the Drydock host provides local storage through `localStorage`. In
Electron, the preload injects a validated `globalThis.drydockHost`, backed by restricted
IPC and local file storage. Future channels can add capabilities without changing the
product's store-neutral host calls.

## Iterating In The Product Submodule

The default live workflow reads directly from Drydock's `product/` submodule:

```sh
pnpm --filter @drydock/web-iterate-caddy-live serve -- --port 8090
```

Edit files under `product/` and refresh the browser. The resolver loads
`product/drydock-product.json` when the iterator starts, then reads selected source files
on every request. Source edits therefore appear without copying, committing, pulling, or
advancing the gitlink. Restart the iterator after changing the contract itself.

For an unusual workflow that needs a different checkout, set the iteration-only
`DRYDOCK_PRODUCT_ROOT` override:

```sh
DRYDOCK_PRODUCT_ROOT=/path/to/product \
  pnpm --filter @drydock/web-iterate-caddy-live serve -- --port 8090
```

The override is optional and should not be present in the normal service configuration.
If used, the selected checkout must remain readable by the service account.

## Reproducible Builds

Static web and Electron deliberately ignore `DRYDOCK_PRODUCT_ROOT`. They:

1. require the initialized `product/` submodule;
2. require a clean checkout at Drydock's exact gitlink;
3. verify the commit is reachable from the product origin;
4. validate `product/drydock-product.json`;
5. stage only the contract-selected product files plus Drydock's host runtime;
6. emit an artifact-schema-v2 manifest.

The manifest records:

```json
{
  "schemaVersion": 2,
  "productId": "line-engine-calibration",
  "buildAdapter": "electron",
  "extensions": {
    "drydock": {
      "productContract": "product/drydock-product.json",
      "productRevision": {
        "path": "product",
        "contract": "product/drydock-product.json",
        "commit": "52e9ec6a8feb51200a268754a8f08d8777a0992e",
        "remote": "https://github.com/valentingalea/Line-Engine.git",
        "tag": "v0.0.1"
      }
    }
  }
}
```

Release channels consume that artifact and manifest. They never read the product
checkout.

## Updating The Pinned Product

Starting at the Drydock repository root, develop and test inside the product submodule:

```sh
cd product

# edit product files
tools/test.sh
git add <product-files>
git commit -m "<product change>"
git push origin main
```

Tag product releases when appropriate:

```sh
git tag -a vX.Y.Z -m "Product vX.Y.Z"
git push origin vX.Y.Z
```

Then deliberately record the new product revision in Drydock:

```sh
cd ..
git add product
pnpm run validate:product
pnpm test
pnpm run validate
git commit -m "Embed product vX.Y.Z"
git push origin main
```

These remain separate commits in separate repositories. The product commit must be
reachable before Drydock records it.

## Substituting A Full Game

A replacement product repository must:

1. include a valid root `drydock-product.json`;
2. own every product source named by that contract;
3. provide a product-side adapter for protocol-v1 host services when it uses them;
4. keep channel and store behavior outside the product;
5. pass the same live, static, Electron, and host-contract checks.

Change the `product/` submodule URL and gitlink, initialize it, and run the complete
validation suite. Drydock should require no knowledge of whether that repository embeds
Line Engine, another browser runtime, or a native engine.

## Target Shapes

Deployments choose their own hostnames and roots. A typical path-mounted setup exposes:

- `/drydock/` for optional live iteration;
- `/drydock-release/` for the packaged pinned-product web artifact;
- `/drydock-downloads/` for packaged desktop downloads.

These route names are examples, not requirements or records of an individual deployment.
