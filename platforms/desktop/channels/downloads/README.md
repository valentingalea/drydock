# Direct Downloads Channel

This channel publishes Electron proof builds as direct download archives. It exists so a
human can download desktop artifacts before Steam/Epic/GOG/itch packaging exists.

It is still not a store release path:

- no auto-update;
- no entitlement check;
- no store metadata;
- no store upload.

The package contains the contract-composed game and Drydock host runtime produced by the
Electron adapter. This channel never reads source checkouts or project declarations; it
packages only the artifact named by `drydock-artifact.json`.

## Public Route

The configured Caddy route should expose only:

- `/`
- `/index.html`
- `/*.zip`
- `/*.zip.sha256`

It deliberately does not expose `drydock-artifact.json`, unpacked build directories,
repo files, or directory browsing.

Package names derive from artifact identity:

- `example-game-0.1.0-windows-x64.zip`
- `example-game-0.1.0-windows-x64.zip.sha256`

## Package Flow

```sh
node drydock/tools/drydock.js build electron \
  --project shipping/drydock-project.json \
  --release shipping/releases/0.1.0.yaml \
  --platform windows \
  --arch x64

node drydock/tools/drydock.js package downloads \
  --project shipping/drydock-project.json \
  --artifact artifacts/build/windows-x64/drydock-artifact.json

DRYDOCK_DOWNLOADS_ROOT=/srv/games \
  node drydock/tools/drydock.js publish downloads \
    --project shipping/drydock-project.json \
    --source artifacts/packages/downloads

pnpm --dir drydock --filter @drydock/channel-downloads run verify -- \
  --base-url https://game.example/downloads/ \
  --name example-game-0.1.0-windows-x64.zip
```

The package script consumes `drydock-artifact.json`, preserves the artifact root inside
the zip, writes a SHA-256 checksum, and renders `index.html`. Package output must remain
separate from the input artifact tree. The publish script verifies those checksums,
opens every zip to validate its embedded artifact manifest and releasability, verifies
the archived payload has exactly the files and byte-level checksums declared by that
manifest, and
replaces only `<operational-root>/<deploymentId>`, where `deploymentId` comes from
`shipping/channels/downloads.yaml`.
Set the Caddy template's `DRYDOCK_DOWNLOAD_ROOT` to the complete published
`<operational-root>/<deploymentId>` directory.

The schema-v3 input manifest preserves checksummed project/release declarations and
exact project, Drydock, and component revisions. Packaging rejects development
artifacts unless `releasable` is explicitly `true`.

## Windows Signing

Yes, the Windows `.exe` can be signed. Signing belongs before packaging the download zip:

```text
BUILD -> optional SIGN -> DOWNLOAD PACKAGE -> PUBLISH -> VERIFY
```

Steam does not provide a general Windows Authenticode signature for this executable.
Steam-specific release steps, install scripts, and optional DRM wrapping are separate from
OS-level code signing. Keep unsigned packages acceptable for proof builds only; production
direct downloads should require signing before this channel writes the public zip.

Supported options to wire later:

- Classic Authenticode signing through electron-builder with `WIN_CSC_LINK` and
  `WIN_CSC_KEY_PASSWORD`.
- Azure Trusted Signing through electron-builder `win.azureSignOptions` and Azure
  service-principal environment variables.
- A Linux-side post-build signing step such as `osslsigncode` if we have a compatible
  PFX/private key and timestamp server.

Use SOPS+age for all signing secrets. Add
`platforms/desktop/channels/downloads/secrets.enc.yaml` only when real credentials exist,
with a matching `.sops.yaml` rule for this channel. `secrets.example` lists the expected
environment variable names.

For production direct downloads, set electron-builder `forceCodeSigning: true` or an
equivalent channel check so missing signing inputs fail the build instead of silently
publishing an unsigned executable.
