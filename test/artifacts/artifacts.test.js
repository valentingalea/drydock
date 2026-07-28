import assert from "node:assert/strict";
import {
  mkdir,
  readFile,
  writeFile
} from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  createArtifactProvenance,
  loadChannelPolicy,
  validateArtifactManifest
} from "../../tools/artifacts.js";
import {
  createMinimalProject,
  harnessRoot,
  loadMinimalVerifiedProject
} from "../support/minimal-project.js";

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
});

async function createProvenanceProject(context) {
  return createMinimalProject(
    context,
    undefined,
    async ({ shippingRoot }) => {
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
    }
  );
}
