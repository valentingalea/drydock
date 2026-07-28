import assert from "node:assert/strict";
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
  buildStaticWeb,
  buildStaticWebCommand,
  parseArgs
} from "../build.js";
import {
  resolveProjectContext,
  runCli
} from "../../../../../tools/drydock.js";
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
      "--profile",
      "development"
    ]),
    {
      release: "shipping/releases/0.1.0.yaml",
      out: "artifacts/tmp/test",
      channel: "preview",
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
  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.buildAdapter, "web-static");
  assert.equal(manifest.productId, "fixture-game");
  assert.equal(manifest.buildNumber, 7);
  assert.deepEqual(manifest.capabilities, ["storage"]);
  assert.equal(manifest.extensions.drydock.entrypoint, "index.html");
  assert.equal(
    manifest.extensions.drydock.project,
    "shipping/drydock-project.json"
  );
  assert.equal(
    manifest.extensions.drydock.release,
    "shipping/releases/0.1.0.yaml"
  );
  assert.equal(
    manifest.extensions.drydock.channelConfig.route,
    "fixture-preview"
  );
  assert.match(
    manifest.extensions.drydock.projectRevision.commit,
    /^[a-f0-9]{40}$/
  );
  assert.equal(
    manifest.extensions.drydock.components.game.commit,
    manifest.extensions.drydock.projectRevision.commit
  );
  assert.equal(
    output.value,
    "built static web artifact: artifacts/build/preview\n"
  );
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

async function createBuildProject(context) {
  return createMinimalProject(
    context,
    undefined,
    async ({ shippingRoot }) => {
      const releaseRoot = join(shippingRoot, "releases");
      await mkdir(releaseRoot);
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
