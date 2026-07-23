# Secrets

How store credentials are stored, and how they reach the packager. Default backend is
**SOPS + age** (git-native, self-hosted); **1Password** is a supported alternative.

## Classify first — not everything is a secret

| Class | Examples | Where it lives |
|---|---|---|
| **Public identifiers** | Steam AppID + depot IDs, iOS bundle ID, Android package name, Apple Team ID, EOS product/sandbox IDs | Committed plainly in `stores/*/metadata`. They ship inside the binary anyway; committing them keeps builds reproducible. |
| **Real secrets** | Signing keys, API keys, service accounts, build passwords | Encrypted at rest, injected at build time. Never plaintext in the repo. |
| **Accounts** | Publisher logins, 2FA | Dedicated least-privilege bot accounts, not personal identities. |

Over-protecting identifiers breaks reproducibility; under-protecting the second row leaks
keys. Keep the line sharp.

## The seam — packagers read env vars only

A packager (`publish.sh`, electron-builder, fastlane, steamcmd) reads secrets **exclusively
from environment variables**. It must not know where they came from.

```
  source of truth  ──►  [ decrypt / inject ]  ──►  env vars  ──►  packager
  (SOPS file / vault)                              $STEAM_BUILD_PW …
```

This decouples storage from consumption: swap the backend without touching a build script.

## One source of truth, two consumers

| Consumer | Backend |
|---|---|
| **CI** (the real release path) | GitHub Actions **environment** secrets, scoped per target so one workflow can't read another's keys. Injected as env at job runtime; gone with the runner. |
| **Local machine** (occasional hand-builds) | The manager, injected into a shell. Never written to a dotfile. |

Feed both from one source so they don't drift.

## Default backend — SOPS + age

- Secrets live **encrypted in the repo** as `stores/<store>/secrets.enc.yaml`, encrypted with
  [age](https://github.com/FiloSottile/age) via [SOPS](https://github.com/getsops/sops).
  Safe to commit — only holders of the age private key can decrypt.
- **Local injection:**
  ```
  sops exec-env platforms/desktop/stores/steam/secrets.enc.yaml ./publish.sh
  ```
- **CI injection:** one age private key held as a GitHub secret decrypts the committed files;
  the encrypted YAML rides along in the checkout.
- **Edit:** `sops platforms/desktop/stores/steam/secrets.enc.yaml` (opens decrypted, re-encrypts on save).

### Alternative — 1Password
Use if you prefer a SaaS manager or expect collaborators. Local: `op run -- ./publish.sh`.
CI: 1Password's GitHub Actions integration, or mirror the handful of values into GitHub
secrets. The packager contract (env vars) is unchanged.

## iOS signing is special — use fastlane `match`

Regardless of backend, iOS certs + provisioning profiles are managed by
[`match`](https://docs.fastlane.tools/actions/match/): it stores them encrypted in a separate
git repo (or bucket) and syncs them onto any Mac / CI runner on demand. Purpose-built to
solve "certs trapped on one developer's Keychain." The `match` passphrase is itself a secret
(SOPS/1Password/CI).

## Per-store inventory

| Store | Public (commit) | Secret (backend only) |
|---|---|---|
| Steam | AppID, depot IDs | builder-account password, Steam Guard config/`ssfn` or TOTP shared secret |
| iOS | Team ID, bundle ID | App Store Connect API key (`.p8` + key id + issuer id); certs/profiles via `match` |
| Android | package name | upload keystore + passwords, Play service-account JSON |
| Epic | product/sandbox/deployment IDs | EOS client secret, BuildPatchTool credentials |

## Rules

1. **Prefer API keys over password+2FA.** App Store Connect API key removes Apple ID 2FA from
   CI; a Play service-account JSON removes human login. Never script interactive 2FA.
2. **Steam Guard is the classic CI blocker.** A fresh runner is untrusted. Solve once: store
   the generated sentry/`config` files as a secret, or keep the TOTP shared secret in the
   backend and compute the code in-pipeline.
3. **Least privilege, dedicated bots.** A build-only Apple ID role, a Steam builder
   sub-account (not the master partner login), a release-scoped Play service account. Leaked
   token → blast radius is publishing, not your whole identity.
4. **Never log secrets.** CI masks registered secrets; avoid `set -x` around injection.
5. **Rotate on a schedule** and when anyone with access leaves. Document expiry (API keys and
   certs expire).

## Repo conventions

| File | Committed? | Purpose |
|---|---|---|
| `stores/<store>/secrets.example` | yes | Lists the required env var **names** only — the contract, no values |
| `stores/<store>/secrets.enc.yaml` | yes (encrypted) | SOPS+age encrypted values (omit if using 1Password) |
| `.env`, `*.p12`, `*.keystore`, `*.mobileprovision`, `*.p8`, service-account JSON | **no** | gitignored; plaintext secrets never committed |

`.sops.yaml` at the repo root declares the age recipients (public keys) authorized to decrypt.
