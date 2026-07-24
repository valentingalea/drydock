# Direct Downloads Channel

This is a temporary testing channel for unsigned Electron proof builds. It exists so a
human can download raw desktop artifacts before Steam/Epic/GOG/itch packaging exists.

It is not a store release path:

- no signing;
- no installer;
- no auto-update;
- no entitlement check;
- no store metadata;
- no SOPS secrets.

## Current VPS Route

`https://vinyltin.duckdns.org/drydock-downloads/` serves files from:

```text
/var/www/drydock-downloads
```

The current Caddy route only exposes:

- `/`
- `/index.html`
- `/drydock-placeholder-1.4.0-windows-x64.zip`
- `/drydock-placeholder-1.4.0-windows-x64.zip.sha256`

It deliberately does not expose `drydock-artifact.json`, unpacked build directories,
repo files, or directory browsing.

## Current Manual Package Flow

```sh
pnpm --filter @drydock/desktop-electron build -- \
  --release releases/1.4.0.yaml \
  --platform windows \
  --arch x64

# Current VPS proof package:
# out/downloads/drydock-placeholder-1.4.0-windows-x64.zip
```

If this channel remains useful, the next step is to add package/publish scripts that
consume `out/<platform>-<arch>/drydock-artifact.json`, create the archive/checksum/index,
copy only those files to `/var/www/drydock-downloads`, and run public allow/deny checks.
