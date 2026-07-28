# Drydock Working Agreements

Drydock is a reusable, productless release toolchain. Consumer game repositories own
their source, dependencies, project descriptor, release declarations, channel policy,
and generated artifacts. Drydock owns schemas, composition, generic adapters, host
runtimes, packaging, publishing, and reusable tests.

## Architecture rules

1. Preserve the pipeline boundary:
   `BUILD -> INTEGRATE -> PACKAGE / SIGN -> PUBLISH`.
2. Keep fast iteration outside the release pipeline.
3. Resolve every project input from the explicit
   `shipping/drydock-project.json`; do not add cwd or Drydock-root fallbacks.
4. Use the shared composition implementation for live reads and staged builds.
5. Keep game identity, runtime mappings, overlays, releases, and channel policy in the
   consumer repository.
6. Every build adapter emits a schema-valid `drydock-artifact.json`. Downstream tools
   consume the artifact and its provenance rather than source-layout assumptions.
7. Development artifacts are explicitly non-releasable. Packaging and publishing must
   reject them.
8. Release verification covers the enclosing project, its declared components, and the
   exact `drydock/` gitlink.
9. Operational destinations, hostnames, accounts, ports, and credentials are explicit
   local inputs. They are not committed as project policy.
10. Drydock contains no game submodule, game-specific route, real release candidate, or
    hosted CI workflow.

## Safety and portability

- Treat descriptor mappings and artifact manifests as untrusted path input.
- Recheck canonical containment after links can change and before reads, copies, or
  destructive operations.
- Confine generated output to the selected project's `artifacts/` tree.
- Namespace shared deployment roots with a validated project-owned `deploymentId`.
- Keep committed documentation, examples, templates, fixtures, and comments portable.
  Use repository-relative commands, configurable variables, or generic placeholders;
  never record a contributor's checkout path, username, private hostname, deployment
  domain, or one-off service configuration.
- Keep optional local overrides optional. Document the repository's self-contained
  workflow first.
- Secrets enter signing or publishing commands through environment variables. Never
  commit plaintext credentials or key material.

## Verification

Run focused tests while editing, then:

```sh
npm test
npm run validate
```

Keep tests generic and create synthetic game repositories under the operating-system
temporary directory. Do not introduce a full example game into Drydock.
