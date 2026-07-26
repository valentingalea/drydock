# Caddy Live Iteration

This package starts the fast web iteration origin. It resolves the product-owned
`product/drydock-product.json`, combines it with Drydock's web host runtime, binds to
`127.0.0.1`, and relies on Caddy for the public allowlist.

```sh
pnpm --filter @drydock/web-iterate-caddy-live serve -- --port 8090
```

Do not serve either repository root, copy the product, or use this path as a release
artifact. The resolver uses the pinned `product/` submodule by default. For an exceptional
iteration workflow, prefix the command with
`DRYDOCK_PRODUCT_ROOT=/path/to/product`.

The product owns all its source mappings and its Drydock adapter. Drydock supplies only
`host-bridge.js` and its vendored runtime contract. Release builds ignore the external
root and reject a dirty, unreachable, or mismatched pinned product. Follow
[`docs/PRODUCT.md`](../../../../docs/PRODUCT.md) before advancing or replacing the pin.

Mount this under a dedicated hostname or an existing domain path such as `/drydock/`
with Caddy `handle_path`. The product uses relative imports so path-mounted testing works.

After starting the origin, verify the menu shows `host v1`, select Play, confirm
`data-line-state="play"` and one canvas, and check that product metadata such as
`/product/drydock-product.json` returns `404`.
