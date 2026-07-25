# Artifacts

Generated build output, packaged channel files, smoke screenshots, and temporary staging
directories live under this ignored root.

Expected layout:

```text
artifacts/
├─ build/       # build adapter output and drydock-artifact.json manifests
├─ channels/    # channel package output such as direct-download zips
├─ smoke/       # browser smoke reports and screenshots
└─ tmp/         # short-lived staging directories
```

Static web and Electron builds stage the runtime selected by
`product/drydock-product.json`; their schema-v2 manifests record the exact product
gitlink, remote, tag, and contract under `extensions.drydock.productRevision`. Channel
folders consume those manifests and staged artifacts, never live files from `product/`
or an external iteration checkout.

Do not hand-edit or commit generated files from these folders. This README is the only
tracked file under the artifact root. See [`docs/PRODUCT.md`](../docs/PRODUCT.md) for the
composition and product-pin workflow.
