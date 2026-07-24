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

Do not commit generated files from these folders.
