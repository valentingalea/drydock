# Direct Downloads Channel

This channel publishes Electron proof builds as direct download archives. It exists so a
human can download desktop artifacts before Steam/Epic/GOG/itch packaging exists.

It is still not a store release path:

- no auto-update;
- no entitlement check;
- no store metadata;
- no store upload.

The package contains the descriptor-composed Line Engine calibration client and Drydock
host bridge produced by the Electron adapter. This channel never reads `engine/` or
recomposes the payload; it packages only the artifact named by
`drydock-artifact.json`.

## Current VPS Route

`https://vinyltin.duckdns.org/drydock-downloads/` serves files from:

```text
/var/www/drydock-downloads
```

The current Caddy route only exposes:

- `/`
- `/index.html`
- `/*.zip`
- `/*.zip.sha256`

It deliberately does not expose `drydock-artifact.json`, unpacked build directories,
repo files, or directory browsing.

Current proof files:

- `line-engine-calibration-0.1.0-windows-x64.zip`
- `line-engine-calibration-0.1.0-windows-x64.zip.sha256`

## Package Flow

```sh
pnpm --filter @drydock/desktop-electron build -- \
  --release contracts/releases/0.1.0.yaml \
  --platform windows \
  --arch x64

pnpm --filter @drydock/channel-downloads run package -- \
  artifacts/build/windows-x64/drydock-artifact.json

pnpm --filter @drydock/channel-downloads run publish -- \
  artifacts/channels/downloads

pnpm --filter @drydock/channel-downloads run verify -- \
  --base-url https://vinyltin.duckdns.org/drydock-downloads/
```

The package script consumes `drydock-artifact.json`, preserves the artifact root inside
the zip, writes a SHA-256 checksum, and renders `index.html`. The publish script replaces
`/var/www/drydock-downloads` with only public package files.

The input manifest preserves `extensions.drydock.engineRevision`, so the download can be
traced to the Line Engine release and commit selected by Drydock. The embedding workflow
is documented in [`docs/PAYLOAD.md`](../../../../docs/PAYLOAD.md).

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
