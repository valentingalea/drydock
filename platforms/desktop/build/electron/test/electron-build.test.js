const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const {
  mkdir,
  readFile,
  stat,
  writeFile
} = require("node:fs/promises");
const { join } = require("node:path");
const test = require("node:test");
const {
  artifactRootForTarget,
  buildElectron,
  createStagedPackage,
  executableForTarget,
  parseArgs,
  prepareStagedApp,
  resolveBuildTarget
} = require("../build.js");

const identity = {
  bundleId: "dev.example.fixture-game",
  executableName: "fixture-game",
  productId: "fixture-game",
  productName: "Fixture Game"
};

test("parses project-relative Electron build arguments", () => {
  assert.deepEqual(parseArgs([
    "--release",
    "shipping/releases/0.1.0.yaml",
    "--out",
    "artifacts/tmp/test",
    "--platform",
    "win32",
    "--arch",
    "x64",
    "--build-key",
    "preview",
    "--profile",
    "development",
    "--skip-package"
  ]), {
    release: "shipping/releases/0.1.0.yaml",
    out: "artifacts/tmp/test",
    platform: "win32",
    arch: "x64",
    buildKey: "preview",
    profile: "development",
    skipPackage: true
  });

  assert.throws(() => parseArgs([]), /--release is required/);
  assert.throws(() => parseArgs(["--arch"]), /--arch requires/);
  assert.throws(
    () => parseArgs([
      "--release",
      "shipping/releases/0.1.0.yaml",
      "--skip-package"
    ]),
    /requires --profile development/
  );
  assert.throws(() => parseArgs([
    "--release",
    "shipping/releases/0.1.0.yaml",
    "--unknown"
  ]), /unknown Electron argument/);
});

test("normalizes Electron build targets and project identity paths", () => {
  assert.deepEqual(resolveBuildTarget({
    arch: "x64",
    platform: "win32"
  }), {
    arch: "x64",
    platform: "windows"
  });
  assert.deepEqual(resolveBuildTarget({
    arch: "arm64",
    platform: "darwin"
  }), {
    arch: "arm64",
    platform: "macos"
  });

  assert.equal(
    artifactRootForTarget({
      arch: "x64",
      platform: "linux"
    }, identity),
    "linux-unpacked"
  );
  assert.equal(
    executableForTarget({
      arch: "x64",
      platform: "windows"
    }, identity),
    "win-unpacked/fixture-game.exe"
  );
  assert.throws(
    () => resolveBuildTarget({
      arch: "x64",
      platform: "freebsd"
    }),
    /unsupported/
  );
});

test("stages Electron shell, project runtime, and exact runtime policy", async (context) => {
  const state = await createElectronState(context);
  const {
    createRuntimeComposition,
    stageRuntime
  } = await import("../../../../../tools/composition.js");
  const composition = await createRuntimeComposition(state.verified);
  const stageDir = join(
    state.fixture.projectRoot,
    "artifacts/tmp/electron-stage/test"
  );

  await prepareStagedApp({
    composition,
    identity,
    release: {
      version: "0.1.0"
    },
    stageDir,
    stageRuntime
  });

  await stat(join(stageDir, "main.js"));
  await stat(join(stageDir, "preload.js"));
  await stat(join(stageDir, "protocol.js"));
  await stat(join(stageDir, "host-provider.js"));
  await stat(join(stageDir, "runtime/index.html"));
  await stat(join(stageDir, "runtime/host-bridge.js"));
  await stat(join(stageDir, "runtime/game/src/value.js"));
  assert.equal(
    await readFile(join(stageDir, "runtime/game/src/platform-host.js"), "utf8"),
    "export const platform = \"overlay\";\n"
  );
  await assert.rejects(stat(join(stageDir, "runtime/shipping")), {
    code: "ENOENT"
  });

  const stagedPackage = JSON.parse(
    await readFile(join(stageDir, "package.json"), "utf8")
  );
  assert.deepEqual(
    stagedPackage,
    createStagedPackage({
      version: "0.1.0"
    }, identity)
  );

  const policy = JSON.parse(
    await readFile(join(stageDir, "runtime-policy.json"), "utf8")
  );
  assert.ok(policy.runtimePaths.includes("index.html"));
  assert.ok(policy.runtimePaths.includes("game/src/value.js"));
  assert.ok(!policy.runtimePaths.includes("drydock-artifact.json"));
  const inlineScript = "\n{\"imports\":{\"fixture\":\"./game/src/value.js\"}}\n";
  assert.deepEqual(policy.scriptHashes, [
    `sha256-${createHash("sha256").update(inlineScript).digest("base64")}`
  ]);
});

test("Electron build emits a generic schema-valid artifact", async (context) => {
  const state = await createElectronState(context);
  const out = join(
    state.fixture.projectRoot,
    "artifacts/build/linux-x64"
  );
  const output = captureStream();
  const { manifest } = await buildElectron({
    context: state.context,
    options: {
      arch: "x64",
      platform: "linux",
      profile: "development",
      release: "shipping/releases/0.1.0.yaml",
      skipPackage: true
    },
    stdout: output,
    verified: state.verified
  });

  await stat(join(out, "linux-unpacked/fixture-game"));
  await stat(join(out, "drydock-artifact.json"));

  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.buildAdapter, "electron");
  assert.equal(manifest.platform, "linux");
  assert.equal(manifest.arch, "x64");
  assert.equal(manifest.artifactRoot, "linux-unpacked");
  assert.equal(manifest.executable, "linux-unpacked/fixture-game");
  assert.equal(manifest.productId, "fixture-game");
  assert.equal(manifest.buildNumber, 9);
  assert.deepEqual(manifest.capabilities, ["storage"]);
  assert.equal(manifest.extensions.drydock.entrypoint, "index.html");
  assert.equal(
    manifest.extensions.drydock.project,
    "shipping/drydock-project.json"
  );
  assert.equal(manifest.extensions.drydock.profile, "development");
  assert.match(
    manifest.extensions.drydock.projectRevision.commit,
    /^[a-f0-9]{40}$/
  );
  assert.equal(manifest.extensions.electron.protocol, "app://drydock");
  assert.equal(
    output.value,
    "built Electron artifact: artifacts/build/linux-x64\n"
  );
});

test("public CLI dispatches the Electron build outside project cwd", async (context) => {
  const state = await createElectronState(context);
  const { runCli } = await import("../../../../../tools/drydock.js");
  const output = captureStream();
  const errors = captureStream();
  const exitCode = await runCli([
    "build",
    "electron",
    "--project",
    state.fixture.projectPath,
    "--release",
    "shipping/releases/0.1.0.yaml",
    "--platform",
    "windows",
    "--arch",
    "x64",
    "--profile",
    "development",
    "--skip-package"
  ], {
    invocationCwd: state.harnessRoot,
    stderr: errors,
    stdout: output
  });

  assert.equal(exitCode, 0, errors.value);
  assert.equal(errors.value, "");
  assert.equal(
    output.value,
    "built Electron artifact: artifacts/build/windows-x64\n"
  );
  await stat(join(
    state.fixture.projectRoot,
    "artifacts/build/windows-x64/win-unpacked/fixture-game.exe"
  ));
});

async function createElectronState(context) {
  const {
    createMinimalProject,
    harnessRoot,
    loadMinimalVerifiedProject
  } = await import("../../../../../test/support/minimal-project.js");
  const fixture = await createMinimalProject(
    context,
    undefined,
    async ({
      gameRoot,
      shippingRoot
    }) => {
      await writeFile(
        join(gameRoot, "index.html"),
        [
          "<!doctype html>",
          "<script type=\"importmap\">",
          "{\"imports\":{\"fixture\":\"./game/src/value.js\"}}",
          "</script>",
          ""
        ].join("\n")
      );
      await mkdir(join(shippingRoot, "releases"));
      await writeFile(
        join(shippingRoot, "releases", "0.1.0.yaml"),
        "version: 0.1.0\nbuild:\n  desktop: 9\n"
      );
    }
  );
  const {
    resolveProjectContext
  } = await import("../../../../../tools/drydock.js");
  const projectContext = await resolveProjectContext(fixture.projectPath, {
    invocationCwd: fixture.projectRoot,
    selectedHarnessRoot: harnessRoot
  });
  const verified = await loadMinimalVerifiedProject(fixture);

  return {
    context: projectContext,
    fixture,
    harnessRoot,
    verified
  };
}

function captureStream() {
  return {
    value: "",
    write(chunk) {
      this.value += chunk;
    }
  };
}
