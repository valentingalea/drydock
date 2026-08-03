import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdir,
  readFile,
  stat,
  writeFile
} from "node:fs/promises";
import { join, resolve } from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import {
  assertRequiredHostCapabilities,
  buildStaticWeb,
  buildStaticWebCommand,
  parseArgs
} from "../build.js";
import {
  resolveProjectContext,
  runCli
} from "../../../../../tools/drydock.js";
import {
  verifyArtifactChecksums
} from "../../../../../tools/artifacts.js";
import {
  createMinimalProject,
  harnessRoot,
  loadMinimalVerifiedProject
} from "../../../../../test/support/minimal-project.js";

test("parses project-relative static build arguments", () => {
  assert.deepEqual(
    parseArgs([
      "--release",
      "shipping/releases/0.1.0.yaml",
      "--out",
      "artifacts/tmp/test",
      "--channel",
      "preview",
      "--channel-policy",
      "shipping/channels/preview.yaml",
      "--profile",
      "development"
    ]),
    {
      release: "shipping/releases/0.1.0.yaml",
      out: "artifacts/tmp/test",
      channel: "preview",
      channelPolicy: "shipping/channels/preview.yaml",
      profile: "development"
    }
  );
  assert.deepEqual(
    parseArgs(["--release", "shipping/releases/0.1.0.yaml"]),
    {
      release: "shipping/releases/0.1.0.yaml",
      profile: "release"
    }
  );
  assert.throws(() => parseArgs([]), /--release is required/);
  assert.throws(() => parseArgs(["--release"]), /--release requires/);
  assert.throws(
    () => parseArgs([
      "--release",
      "shipping/releases/0.1.0.yaml",
      "--release",
      "shipping/releases/0.2.0.yaml"
    ]),
    /only once/
  );
  assert.throws(
    () => parseArgs([
      "--release",
      "shipping/releases/0.1.0.yaml",
      "--profile",
      "local"
    ]),
    /--profile/
  );
});

test("static build stages project composition and emits a generic artifact", async (context) => {
  const fixture = await createBuildProject(context);
  const projectContext = await resolveContext(fixture);
  const verified = await loadMinimalVerifiedProject(fixture);
  const output = captureStream();
  const { manifest, outDir } = await buildStaticWeb({
    context: projectContext,
    options: {
      channel: "preview",
      out: "artifacts/build/preview",
      profile: "development",
      release: "shipping/releases/0.1.0.yaml"
    },
    stdout: output,
    verified
  });

  await stat(join(outDir, "index.html"));
  await stat(join(outDir, "host-bridge.js"));
  await stat(join(outDir, "vendor/drydock-host-bridge/index.js"));
  await stat(join(outDir, "game/src/value.js"));
  assert.equal(
    await readFile(join(outDir, "game/src/platform-host.js"), "utf8"),
    "export const platform = \"overlay\";\n"
  );

  await assert.rejects(stat(join(outDir, "package.json")), {
    code: "ENOENT"
  });
  await assert.rejects(stat(join(outDir, "shipping")), {
    code: "ENOENT"
  });
  await assert.rejects(stat(join(outDir, ".git")), {
    code: "ENOENT"
  });

  const schema = JSON.parse(
    await readFile(
      resolve(harnessRoot, "contracts/schemas/drydock-artifact.schema.json"),
      "utf8"
    )
  );
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true
  });
  const validate = ajv.compile(schema);

  assert.equal(validate(manifest), true, JSON.stringify(validate.errors, null, 2));
  assert.equal(manifest.platform, "web");
  assert.equal(manifest.schemaVersion, 3);
  assert.equal(manifest.releasable, false);
  assert.equal(manifest.buildAdapter, "web-static");
  assert.equal(manifest.productId, "fixture-game");
  assert.equal(manifest.buildNumber, 7);
  assert.deepEqual(manifest.capabilities, ["storage"]);
  assert.equal(manifest.extensions.drydock.entrypoint, "index.html");
  assert.equal(
    manifest.provenance.channelPolicy.snapshot.route,
    "fixture-preview"
  );
  assert.equal(
    manifest.provenance.project.descriptor.path,
    "shipping/drydock-project.json"
  );
  assert.equal(
    manifest.provenance.release.path,
    "shipping/releases/0.1.0.yaml"
  );
  assert.match(
    manifest.provenance.project.commit,
    /^[a-f0-9]{40}$/
  );
  assert.equal(
    manifest.provenance.components.game.commit,
    manifest.provenance.project.commit
  );
  assert.equal(manifest.provenance.adapter.profile, "development");
  assert.equal(
    output.value,
    "built static web artifact: artifacts/build/preview\n"
  );
});

test("static build materializes a web root for a custom entrypoint", async (context) => {
  const fixture = await createBuildProject(context, {
    entrypoint: "ui/start.html"
  });
  const projectContext = await resolveContext(fixture);
  const verified = await loadMinimalVerifiedProject(fixture);
  const { manifest, outDir } = await buildStaticWeb({
    context: projectContext,
    options: {
      channel: "preview",
      out: "artifacts/build/custom-entrypoint",
      profile: "development",
      release: "shipping/releases/0.1.0.yaml"
    },
    verified
  });

  assert.match(
    await readFile(join(outDir, "index.html"), "utf8"),
    /url=ui\/start\.html/
  );
  assert.equal(
    await readFile(join(outDir, "ui/start.html"), "utf8"),
    "<!doctype html><title>Custom entrypoint</title>\n"
  );
  assert.equal(manifest.extensions.drydock.entrypoint, "ui/start.html");
  assert.ok(
    manifest.checksums.some((checksum) => checksum.path === "index.html")
  );
  assert.ok(
    manifest.checksums.some((checksum) => checksum.path === "ui/start.html")
  );
  await assert.doesNotReject(
    verifyArtifactChecksums(
      manifest,
      join(outDir, "drydock-artifact.json")
    )
  );
});

test("static build rejects host capabilities its browser host cannot provide", async (context) => {
  const fixture = await createBuildProject(context, {
    requiredCapabilities: [
      "storage",
      "identity"
    ]
  });
  const projectContext = await resolveContext(fixture);
  const verified = await loadMinimalVerifiedProject(fixture);

  assert.throws(
    () => assertRequiredHostCapabilities(["storage", "identity"]),
    /web-static host does not provide required capabilities: identity/
  );
  await assert.rejects(
    buildStaticWeb({
      context: projectContext,
      options: {
        channel: "preview",
        profile: "development",
        release: "shipping/releases/0.1.0.yaml"
      },
      verified
    }),
    /web-static host does not provide required capabilities: identity/
  );
});

test("static build validates the release schema and selected channel", async (context) => {
  const fixture = await createBuildProject(context);
  const projectContext = await resolveContext(fixture);
  const verified = await loadMinimalVerifiedProject(fixture);
  const releasePath = join(fixture.shippingRoot, "releases", "0.1.0.yaml");

  await writeFile(
    releasePath,
    "version: 0.1.0\nbuild:\n  preview: 7\n"
  );
  await assert.rejects(
    buildStaticWeb({
      context: projectContext,
      options: {
        channel: "preview",
        out: "artifacts/build/invalid-release",
        profile: "development",
        release: "shipping/releases/0.1.0.yaml"
      },
      verified
    }),
    /required property 'channels'/
  );

  await writeFile(
    releasePath,
    [
      "version: 0.1.0",
      "build:",
      "  preview: 7",
      "channels:",
      "  other: {}",
      ""
    ].join("\n")
  );
  await assert.rejects(
    buildStaticWeb({
      context: projectContext,
      options: {
        channel: "preview",
        out: "artifacts/build/undeclared-channel",
        profile: "development",
        release: "shipping/releases/0.1.0.yaml"
      },
      verified
    }),
    /does not declare channel\.preview/
  );
});

test("static release preflight fails before creating build output", async (context) => {
  const fixture = await createBuildProject(context);
  const projectContext = await resolveContext(fixture);
  const development = await loadMinimalVerifiedProject(fixture);
  const outDir = join(
    fixture.projectRoot,
    "artifacts/build/release-preflight"
  );

  await assert.rejects(
    buildStaticWeb({
      context: projectContext,
      options: {
        channel: "preview",
        out: "artifacts/build/release-preflight",
        profile: "release",
        release: "shipping/releases/0.1.0.yaml"
      },
      verified: {
        ...development,
        profile: "release"
      }
    }),
    /Drydock at the project drydock\/ gitlink/
  );
  await assert.rejects(stat(outDir), {
    code: "ENOENT"
  });
});

test("static command contains release and output paths inside the project", async (context) => {
  const fixture = await createBuildProject(context);
  const projectContext = await resolveContext(fixture);
  const errors = captureStream();

  assert.equal(
    await buildStaticWebCommand({
      args: [],
      context: projectContext,
      stderr: errors,
      stdout: captureStream()
    }),
    2
  );
  assert.match(errors.value, /--release is required/);

  const verified = await loadMinimalVerifiedProject(fixture);
  await assert.rejects(
    buildStaticWeb({
      context: projectContext,
      options: {
        out: "../outside",
        profile: "development",
        release: "shipping/releases/0.1.0.yaml"
      },
      verified
    }),
    /build output escapes the project root/
  );
  await assert.rejects(
    buildStaticWeb({
      context: projectContext,
      options: {
        profile: "development",
        release: "game/index.html"
      },
      verified
    }),
    /release must resolve below shipping\/releases/
  );
});

test("public CLI builds from outside the project working directory", async (context) => {
  const fixture = await createBuildProject(context);
  const output = captureStream();
  const errors = captureStream();
  const exitCode = await runCli([
    "build",
    "web-static",
    "--project",
    fixture.projectPath,
    "--release",
    "shipping/releases/0.1.0.yaml",
    "--channel",
    "preview",
    "--profile",
    "development"
  ], {
    invocationCwd: harnessRoot,
    stderr: errors,
    stdout: output
  });

  assert.equal(exitCode, 0, errors.value);
  assert.equal(errors.value, "");
  assert.equal(
    output.value,
    "built static web artifact: artifacts/build/web-static\n"
  );
  await stat(
    join(
      fixture.projectRoot,
      "artifacts/build/web-static/drydock-artifact.json"
    )
  );
});

test("direct CLI invocation builds without an import cycle", async (context) => {
  const fixture = await createBuildProject(context);
  const result = spawnSync(
    process.execPath,
    [
      resolve(harnessRoot, "tools/drydock.js"),
      "build",
      "web-static",
      "--project",
      fixture.projectPath,
      "--release",
      "shipping/releases/0.1.0.yaml",
      "--channel",
      "preview",
      "--profile",
      "development"
    ],
    {
      cwd: harnessRoot,
      encoding: "utf8",
      timeout: 10_000
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.signal, null);
  assert.equal(result.stderr, "");
  assert.equal(
    result.stdout,
    "built static web artifact: artifacts/build/web-static\n"
  );
});

async function createBuildProject(context, {
  entrypoint = "index.html",
  requiredCapabilities = [
    "storage"
  ]
} = {}) {
  return createMinimalProject(
    context,
    (descriptor) => {
      descriptor.host.requiredCapabilities = requiredCapabilities;
      if (entrypoint !== "index.html") {
        descriptor.runtime.entrypoint = entrypoint;
        descriptor.runtime.entries[0] = {
          component: "game",
          source: "start.html",
          target: entrypoint
        };
      }
    },
    async ({ gameRoot, shippingRoot }) => {
      if (entrypoint !== "index.html") {
        await writeFile(
          join(gameRoot, "start.html"),
          "<!doctype html><title>Custom entrypoint</title>\n"
        );
      }
      const releaseRoot = join(shippingRoot, "releases");
      await mkdir(releaseRoot);
      await mkdir(join(shippingRoot, "channels"));
      await writeFile(
        join(releaseRoot, "0.1.0.yaml"),
        [
          "version: 0.1.0",
          "build:",
          "  preview: 7",
          "  vps: 8",
          "channels:",
          "  preview:",
          "    route: fixture-preview",
          ""
        ].join("\n")
      );
      await writeFile(
        join(shippingRoot, "channels", "preview.yaml"),
        "route: fixture-preview\n"
      );
      await writeFile(
        join(shippingRoot, "channels", "vps.yaml"),
        "deploymentId: fixture-game\nroute: fixture-vps\n"
      );
    }
  );
}

async function resolveContext(fixture) {
  return resolveProjectContext(fixture.projectPath, {
    invocationCwd: fixture.projectRoot,
    selectedHarnessRoot: harnessRoot
  });
}

function captureStream() {
  return {
    value: "",
    write(chunk) {
      this.value += chunk;
    }
  };
}
