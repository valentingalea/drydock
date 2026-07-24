# Secrets

Drydock uses **SOPS + age** as the supported secrets workflow. Encrypted secret files are
committed beside the channel that uses them; plaintext values are decrypted only into a
process environment for local commands or CI jobs.

## Classify First

| Class | Examples | Where it lives |
|---|---|---|
| Public identifiers | Steam AppID + depot IDs, iOS bundle ID, Android package name, Apple Team ID, EOS product/sandbox IDs | Committed plainly in channel metadata. They ship inside binaries or dashboards anyway. |
| Real secrets | Signing keys, API keys, service accounts, build passwords, TOTP shared secrets | SOPS-encrypted YAML committed in the owning channel folder. |
| Accounts | Publisher logins, 2FA ownership | Dedicated least-privilege bot/service accounts, not personal identities. |

Over-protecting identifiers breaks reproducibility. Under-protecting real secrets leaks
publishing authority.

## Contract: Packagers Read Env Vars Only

A packager or publisher (`publish.sh`, electron-builder, fastlane, steamcmd, Butler,
BuildPatchTool) reads secrets exclusively from environment variables. It must not know
where those variables came from.

```text
SOPS encrypted file -> decrypt/inject -> env vars -> packager
```

This keeps scripts stable while allowing local and CI injection to use the same encrypted
source file.

## File Layout

Each channel owns its own secret contract and encrypted values:

```text
platforms/desktop/channels/steam/
├─ secrets.example
└─ secrets.enc.yaml

platforms/desktop/channels/downloads/
├─ secrets.example
└─ secrets.enc.yaml

platforms/mobile/channels/appstore/
├─ secrets.example
└─ secrets.enc.yaml
```

`secrets.example` lists required environment variable names only:

```text
STEAM_USERNAME=
STEAM_PASSWORD=
STEAM_TOTP_SHARED_SECRET=
```

`secrets.enc.yaml` contains the encrypted values:

```yaml
STEAM_USERNAME: ENC[AES256_GCM,...]
STEAM_PASSWORD: ENC[AES256_GCM,...]
STEAM_TOTP_SHARED_SECRET: ENC[AES256_GCM,...]
```

## `.sops.yaml`

The repo root `.sops.yaml` declares age recipients. Prefer a separate recipient group per
release channel so one workflow cannot decrypt another channel's secrets.

Example shape:

```yaml
creation_rules:
  - path_regex: platforms/desktop/channels/steam/secrets\.enc\.yaml$
    age: age1steamrecipient...

  - path_regex: platforms/mobile/channels/appstore/secrets\.enc\.yaml$
    age: age1appstorerecipient...

  - path_regex: platforms/mobile/channels/play/secrets\.enc\.yaml$
    age: age1playrecipient...
```

Developer recipients can be added to the relevant channel rule when they need local
release access. Do not use one global decrypt key for every channel unless the project is
still a private solo prototype.

## Local Use

Run channel commands through `sops exec-env`:

```sh
sops exec-env platforms/desktop/channels/steam/secrets.enc.yaml \
  'pnpm --filter @drydock/channel-steam publish -- out/win32-x64/drydock-artifact.json'
```

For multi-step local work, open a scoped shell:

```sh
sops exec-env platforms/desktop/channels/steam/secrets.enc.yaml bash
```

Do not write decrypted values to `.env`, shell profiles, committed config, or build logs.

## CI Use

Each workflow decrypts only its own channel file.

1. The workflow stores the matching age private key as a GitHub environment secret, for
   example `SOPS_AGE_KEY_STEAM`.
2. The job writes that key to a temporary file or exports `SOPS_AGE_KEY`.
3. The job runs `sops exec-env <channel>/secrets.enc.yaml '<command>'`.
4. The command builds/packages/publishes using env vars only.
5. The runner is discarded.

CI should use GitHub Environments for approvals and scoping, but channel credentials
themselves live in SOPS files. The GitHub secret is only the age private key needed to
decrypt that channel's file.

## Windows Signing

Windows Authenticode signing material is a project credential, not something Steam grants
for free. Steam packaging, Steam install scripts, and optional Steam DRM wrapping are
separate from OS-level code signing.

Keep Windows signing inputs in the channel that performs the signing step. The direct
downloads proof channel reserves
`platforms/desktop/channels/downloads/secrets.enc.yaml` for `WIN_CSC_LINK`,
`WIN_CSC_KEY_PASSWORD`, Azure Trusted Signing service-principal values, or equivalent
signing-tool inputs. A future Steam channel may either keep Steam-only credentials in its
own `secrets.enc.yaml` and require an already signed artifact, or own a Steam-specific
signing step with its own SOPS-encrypted signing inputs. Do not share a plaintext PFX or
service-principal secret between channels.

## iOS Signing

iOS certificates and provisioning profiles should use fastlane `match`. The match
repository or storage bucket is separate from this repo. The `MATCH_PASSWORD`,
App Store Connect API key fields, and any other lane secrets live in
`platforms/mobile/channels/appstore/secrets.enc.yaml`.

Prefer App Store Connect API keys over Apple ID sessions so CI does not depend on
interactive 2FA.

## Per-Channel Inventory

| Channel | Public values | SOPS-encrypted values |
|---|---|---|
| VPS web | Hostname, deploy root, Caddy route name | Optional SSH deploy key if publishing from a remote runner; none if publishing locally on the VPS |
| Direct downloads | Public download route, package names | Optional Windows signing certificate/password or Azure Trusted Signing service-principal credentials |
| Steam | AppID, depot IDs, public achievement IDs | Builder username/password, Steam Guard sentry/config or TOTP shared secret |
| Epic | Product/sandbox/deployment IDs, artifact labels | EOS client secret, BuildPatchTool credentials |
| itch | Project slug, channel names | Butler API key |
| App Store | Team ID, bundle ID, SKU | App Store Connect API key, `MATCH_PASSWORD`, match repo credentials if needed |
| Google Play | Android package name | Upload keystore, keystore passwords, Play service-account JSON |

## Rules

1. Prefer API keys over password+2FA whenever the store supports them.
2. Use least-privilege bot/service accounts for publishing.
3. Avoid `set -x` around secret injection and upload commands.
4. Rotate age recipients and store credentials when access changes.
5. Document secret expiry dates where the platform has them.
6. Never commit plaintext `.env`, `*.p12`, `*.keystore`, `*.mobileprovision`, `*.p8`, or
   service-account JSON files.

## Git Ignore Expectations

Committed:

- `secrets.example`
- `secrets.enc.yaml`
- `.sops.yaml`

Ignored:

- `.env`
- `*.p12`
- `*.keystore`
- `*.mobileprovision`
- `*.p8`
- service-account JSON files
- SDK caches and downloaded SDK archives
