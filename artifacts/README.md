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
`game/drydock-payload.json`; their manifests record the exact Line Engine release,
gitlink commit, remote, and Three.js revision under
`extensions.drydock.engineRevision`. Channel folders consume those manifests and staged
artifacts, never live files from `engine/`.

Do not hand-edit or commit generated files from these folders. This README is the only
tracked file under the artifact root. See [`docs/PAYLOAD.md`](../docs/PAYLOAD.md) for the
composition and engine-pin workflow.
