# Secrets and Operational Inputs

Drydock keeps public project policy separate from secret and machine-specific inputs.

Commit:

- stable product/application identifiers;
- release versions and build numbers;
- channel identifiers and `deploymentId` values;
- `secrets.example` files containing variable names only;
- SOPS-encrypted values and a portable `.sops.yaml` when a game adopts them.

Do not commit:

- plaintext credentials, signing keys, certificates, or service-account JSON;
- age identities;
- operational filesystem roots, account names, or private hostnames;
- contributor checkout paths or local `.env` files.

## Manual injection

Packagers and publishers read secrets from environment variables. They do not know
whether values came from a password manager, an encrypted file, or a scoped shell:

```text
secret store or SOPS file -> process environment -> channel command
```

For a channel that uses SOPS:

```sh
sops exec-env shipping/channels/example/secrets.enc.yaml \
  'node drydock/tools/drydock.js publish <channel> --project shipping/drydock-project.json'
```

Do not enable shell tracing around secret injection or upload commands.

## Operational configuration

Non-secret machine state is still external. Current publishers require:

- `DRYDOCK_VPS_ROOT` or `publish vps --root`;
- `DRYDOCK_DOWNLOADS_ROOT` or `publish downloads --root`;
- configured public URLs for verification;
- Caddy/systemd configuration copied and parameterized for the target host.

Publishers reject filesystem roots and symlinked operational roots, then replace only
the validated `<root>/<deploymentId>` namespace.

Use least-privilege publishing accounts, rotate credentials when access changes, and
keep each channel's secret inventory independent.
