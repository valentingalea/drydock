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

Static web and Electron builds stage only the runtime selected by the external project
contract. Their schema-v3 manifests record checksummed project and release declarations,
exact project/Drydock/component commits, adapter profile, and any channel-policy
snapshot under `provenance`. Channel folders consume those manifests and reject
artifacts unless `releasable` is explicitly `true`.

Do not hand-edit or commit generated files from these folders. This README is the only
tracked file under the artifact root.
