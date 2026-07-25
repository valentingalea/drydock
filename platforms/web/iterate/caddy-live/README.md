# Caddy Live Iteration

This package starts the fast web iteration origin. It resolves the product-owned
`drydock-product.json` from `DRYDOCK_PRODUCT_ROOT`, combines it with Drydock's web host
runtime, binds to `127.0.0.1`, and relies on Caddy for the public allowlist.

```sh
DRYDOCK_PRODUCT_ROOT=/usr/games/engine \
  pnpm --filter @drydock/web-iterate-caddy-live serve -- --port 8090
```

Do not serve either repository root, copy the product, or use this path as a release
artifact. With no override, the resolver falls back to the pinned `product/` submodule.

The product owns all its source mappings and its Drydock adapter. Drydock supplies only
`host-bridge.js` and its vendored runtime contract. Release builds ignore the external
root and reject a dirty, unreachable, or mismatched pinned product. Follow
[`docs/PRODUCT.md`](../../../../docs/PRODUCT.md) before advancing or replacing the pin.

If there is no spare DuckDNS hostname, mount this under an existing domain path such as
`/drydock/` with Caddy `handle_path`. The product uses relative imports so path-mounted
testing works.

After starting the origin, verify the menu shows `host v1`, select Play, confirm
`data-line-state="play"` and one canvas, and check that product metadata such as
`/product/drydock-product.json` returns `404`.
