import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  createArtifactProvenance,
  loadChannelPolicy,
  resolveArtifactPayloadRoot,
  sanitizeRemoteUrl,
  validateArtifactManifest,
  verifyArtifactChecksums
} from "../../tools/artifacts.js";
import {
  createMinimalProject,
  harnessRoot,
  loadMinimalVerifiedProject
} from "../support/minimal-project.js";

test("removes credentials from provenance remote URLs", () => {
  assert.equal(
    sanitizeRemoteUrl([
      "https://release-user:secret-token@example.com/games/fixture.git",
      "?access_token=secret-token",
      "#private-fragment"
    ].join("")),
    "https://example.com/games/fixture.git"
  );
  assert.equal(
    sanitizeRemoteUrl("git@example.com:games/fixture.git"),
    "git@example.com:games/fixture.git"
  );
});

test("records portable project, release, component, and policy provenance", async (context) => {
  const fixture = await createProvenanceProject(context);
  const verified = await loadMinimalVerifiedProject(fixture);
  const releasePath = join(
    fixture.shippingRoot,
    "releases",
    "0.1.0.yaml"
  );
  const channelPolicy = await loadChannelPolicy({
    channel: "preview",
    context: verified.project.context
  });
  const provenance = await createArtifactProvenance({
    adapter: {
      id: "web-static",
      package: "@drydock/web-static"
    },
    channelPolicy,
    releasePath,
    verified
  });

  assert.deepEqual(provenance.adapter, {
    id: "web-static",
    package: "@drydock/web-static",
    profile: "development"
  });
  assert.equal(
    provenance.project.descriptor.path,
    "shipping/drydock-project.json"
  );
  assert.equal(provenance.release.path, "shipping/releases/0.1.0.yaml");
  assert.match(provenance.project.descriptor.sha256, /^[a-f0-9]{64}$/);
  assert.match(provenance.release.sha256, /^[a-f0-9]{64}$/);
  assert.match(provenance.drydock.commit, /^[a-f0-9]{40,64}$/);
  assert.equal(provenance.components.game.path, "game");
  assert.equal(
    provenance.components.game.commit,
    provenance.project.commit
  );
  assert.deepEqual(provenance.channelPolicy.snapshot, {
    route: "fixture-preview"
  });
  assert.equal(provenance.channelPolicy.path, "shipping/channels/preview.yaml");
  assert.doesNotMatch(JSON.stringify(provenance), /\/usr\/games\//);
});

test("release provenance requires the project's exact drydock gitlink", async (context) => {
  const fixture = await createProvenanceProject(context);
  const development = await loadMinimalVerifiedProject(fixture);
  const verified = {
    ...development,
    profile: "release"
  };

  await assert.rejects(
    createArtifactProvenance({
      adapter: {
        id: "web-static",
        package: "@drydock/web-static"
      },
      releasePath: join(
        fixture.shippingRoot,
        "releases",
        "0.1.0.yaml"
      ),
      verified
    }),
    /Drydock at the project drydock\/ gitlink/
  );
});

test("release provenance requires tracked project declarations", async (context) => {
  const cases = [
    {
      ignoredPath: "/shipping/drydock-project.json",
      label: "project descriptor"
    },
    {
      ignoredPath: "/shipping/releases/0.1.0.yaml",
      label: "release declaration"
    },
    {
      ignoredPath: "/shipping/channels/preview.yaml",
      label: "channel policy"
    }
  ];

  for (const selected of cases) {
    await context.test(selected.label, async (subcontext) => {
      const fixture = await createProvenanceProject(
        subcontext,
        selected.ignoredPath
      );
      const verified = await loadMinimalVerifiedProject(fixture);
      const releasePath = join(
        fixture.shippingRoot,
        "releases",
        "0.1.0.yaml"
      );
      const channelPolicy = await loadChannelPolicy({
        channel: "preview",
        context: verified.project.context
      });

      await assert.rejects(
        createArtifactProvenance({
          adapter: {
            id: "web-static",
            package: "@drydock/web-static"
          },
          channelPolicy,
          releasePath,
          verified: {
            ...verified,
            profile: "release"
          }
        }),
        new RegExp(
          `release ${selected.label} must be tracked at project commit`
        )
      );
    });
  }
});

test("artifact schema requires explicit, profile-consistent releasability", async () => {
  const fixturePath = resolve(
    harnessRoot,
    "contracts/fixtures/artifacts/electron-windows-x64.json"
  );
  const manifest = JSON.parse(await readFile(fixturePath, "utf8"));
  await assert.doesNotReject(
    validateArtifactManifest(manifest, harnessRoot)
  );

  const missing = structuredClone(manifest);
  delete missing.releasable;
  await assert.rejects(
    validateArtifactManifest(missing, harnessRoot),
    /invalid artifact manifest/
  );

  const inconsistent = structuredClone(manifest);
  inconsistent.provenance.adapter.profile = "development";
  await assert.rejects(
    validateArtifactManifest(inconsistent, harnessRoot),
    /invalid artifact manifest/
  );

  for (const artifactRoot of [
    "C:/external-artifact",
    "C:relative",
    "./payload",
    "payload//nested",
    "payload.",
    "CON"
  ]) {
    const nonportable = structuredClone(manifest);
    nonportable.artifactRoot = artifactRoot;
    await assert.rejects(
      validateArtifactManifest(nonportable, harnessRoot),
      /invalid artifact manifest/
    );
  }
});

test("artifact payload roots require canonical manifest containment", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "drydock-artifact-root-"));
  context.after(() => rm(root, {
    force: true,
    recursive: true
  }));
  const manifestPath = join(root, "drydock-artifact.json");
  const payloadRoot = join(root, "payload");
  await mkdir(payloadRoot);
  await writeFile(manifestPath, "{}\n");

  assert.equal(
    await resolveArtifactPayloadRoot({
      artifactRoot: "payload"
    }, manifestPath),
    payloadRoot
  );
  await assert.rejects(
    resolveArtifactPayloadRoot({
      artifactRoot: "../outside"
    }, manifestPath),
    /artifact root must be a portable relative path/
  );
  await assert.rejects(
    resolveArtifactPayloadRoot({
      artifactRoot: "C:outside"
    }, manifestPath),
    /artifact root must be a portable relative path/
  );

  await symlink(payloadRoot, join(root, "linked-payload"));
  await assert.rejects(
    resolveArtifactPayloadRoot({
      artifactRoot: "linked-payload"
    }, manifestPath),
    /artifact root must be a real directory/
  );
});

test("artifact verification requires an exact regular-file checksum set", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "drydock-artifact-tree-"));
  context.after(() => rm(root, {
    force: true,
    recursive: true
  }));
  const manifestPath = join(root, "drydock-artifact.json");
  const payloadPath = join(root, "payload.bin");
  const manifest = {
    checksums: [
      {
        algorithm: "sha256",
        path: "payload.bin",
        value: createHash("sha256").update("payload\n").digest("hex")
      }
    ]
  };

  await writeFile(manifestPath, "{}\n");
  await writeFile(payloadPath, "payload\n");
  await assert.doesNotReject(
    verifyArtifactChecksums(manifest, manifestPath)
  );

  await writeFile(join(root, "stale.bin"), "stale\n");
  await assert.rejects(
    verifyArtifactChecksums(manifest, manifestPath),
    /artifact file is not checksummed: stale\.bin/
  );
  await rm(join(root, "stale.bin"));

  await symlink(payloadPath, join(root, "linked.bin"));
  await assert.rejects(
    verifyArtifactChecksums(manifest, manifestPath),
    /artifact tree must not contain symbolic links: linked\.bin/
  );
});

async function createProvenanceProject(context, ignoredPath = null) {
  return createMinimalProject(
    context,
    undefined,
    async ({ projectRoot, shippingRoot }) => {
      await mkdir(join(shippingRoot, "releases"));
      await mkdir(join(shippingRoot, "channels"));
      await writeFile(
        join(shippingRoot, "releases", "0.1.0.yaml"),
        "version: 0.1.0\nbuild:\n  preview: 1\n"
      );
      await writeFile(
        join(shippingRoot, "channels", "preview.yaml"),
        "route: fixture-preview\n"
      );
      if (ignoredPath) {
        await appendFile(
          join(projectRoot, ".gitignore"),
          `${ignoredPath}\n`
        );
      }
    }
  );
}
