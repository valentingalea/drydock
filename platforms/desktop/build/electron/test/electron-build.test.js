const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile
} = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const test = require("node:test");
const {
  artifactRootForTarget,
  buildElectron,
  createStagedPackage,
  executableForTarget,
  inlineScriptHashes,
  materializeArtifactLinks,
  movePackagedArtifact,
  parseArgs,
  prepareStagedApp,
  resolveBuildTarget,
  runElectronBuilder
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
    () => artifactRootForTarget({
      arch: "arm64",
      platform: "macos"
    }, {
      ...identity,
      productName: "../escape"
    }),
    /product name must be safe/
  );
  assert.throws(
    () => resolveBuildTarget({
      arch: "x64",
      platform: "freebsd"
    }),
    /unsupported/
  );
});

test("materializes contained Electron bundle links before checksumming", async (context) => {
  const artifactRoot = await mkdtemp(join(tmpdir(), "drydock-electron-app-"));
  const outsideRoot = await mkdtemp(join(tmpdir(), "drydock-electron-outside-"));
  context.after(() => rm(artifactRoot, {
    force: true,
    recursive: true
  }));
  context.after(() => rm(outsideRoot, {
    force: true,
    recursive: true
  }));

  const versionRoot = join(artifactRoot, "Versions", "A");
  await mkdir(join(versionRoot, "Resources"), {
    recursive: true
  });
  await writeFile(
    join(versionRoot, "fixture-game"),
    "fake executable\n",
    {
      mode: 0o755
    }
  );
  await writeFile(
    join(versionRoot, "Resources", "info.txt"),
    "framework resources\n"
  );
  await symlink("A", join(artifactRoot, "Versions", "Current"), "dir");
  await symlink(
    "Versions/Current/fixture-game",
    join(artifactRoot, "fixture-game")
  );
  await symlink(
    "Versions/Current/Resources",
    join(artifactRoot, "Resources"),
    "dir"
  );

  await materializeArtifactLinks(artifactRoot);

  assert.equal(
    (await lstat(join(artifactRoot, "Versions", "Current"))).isDirectory(),
    true
  );
  assert.equal(
    (await lstat(join(artifactRoot, "fixture-game"))).isFile(),
    true
  );
  assert.equal(
    await readFile(join(artifactRoot, "Resources", "info.txt"), "utf8"),
    "framework resources\n"
  );
  assert.notEqual(
    (await stat(join(artifactRoot, "fixture-game"))).mode & 0o111,
    0
  );

  const outsideFile = join(outsideRoot, "outside.txt");
  const escapingLink = join(artifactRoot, "escaping-link");
  await writeFile(outsideFile, "outside\n");
  await symlink(outsideFile, escapingLink);
  await assert.rejects(
    materializeArtifactLinks(artifactRoot),
    /link resolves outside its artifact root/
  );
  assert.equal((await lstat(escapingLink)).isSymbolicLink(), true);
});

test("invokes the package-local Electron builder without a PATH lookup", async () => {
  let invocation;
  const outDir = resolve("fixture-project", "artifacts/build/linux-x64");
  const stageDir = resolve(
    "fixture-project",
    "artifacts/tmp/electron-stage/linux-x64"
  );
  await runElectronBuilder({
    identity,
    outDir,
    runCommand: async (command, args) => {
      invocation = {
        args,
        command
      };
    },
    stageDir,
    target: {
      arch: "x64",
      platform: "linux"
    }
  });

  assert.equal(invocation.command, process.execPath);
  assert.equal(
    invocation.args[0],
    require.resolve("electron-builder/cli.js")
  );
  assert.deepEqual(
    invocation.args.slice(1, 5),
    [
      "--dir",
      "--projectDir",
      stageDir,
      "--config"
    ]
  );
});

test("moves only the packaged payload out of transient builder output", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "drydock-electron-builder-"));
  context.after(() => rm(root, {
    force: true,
    recursive: true
  }));
  const builderOutDir = join(root, "builder");
  const outDir = join(root, "artifact");
  await mkdir(join(builderOutDir, "win-unpacked"), {
    recursive: true
  });
  await mkdir(outDir);
  await writeFile(
    join(builderOutDir, "win-unpacked", "fixture-game.exe"),
    "fake executable\n"
  );
  await writeFile(join(builderOutDir, "builder-debug.yml"), "debug: true\n");
  await writeFile(
    join(builderOutDir, "builder-effective-config.yaml"),
    "productName: Fixture Game\n"
  );

  await movePackagedArtifact({
    artifactRoot: "win-unpacked",
    builderOutDir,
    outDir
  });

  assert.deepEqual(await readdir(outDir), ["win-unpacked"]);
  assert.deepEqual((await readdir(builderOutDir)).sort(), [
    "builder-debug.yml",
    "builder-effective-config.yaml"
  ]);
  assert.equal(
    await readFile(join(outDir, "win-unpacked", "fixture-game.exe"), "utf8"),
    "fake executable\n"
  );
});

test("uses HTML tokenization when hashing inline scripts", async () => {
  const windowsHtml = [
    "<!doctype html>",
    "<script data-value=\">\">",
    "window.platform = \"windows\";",
    "</script >",
    "<script src=\"external.js\">ignored()</script>",
    ""
  ].join("\r\n");
  const normalizedScript = "\nwindow.platform = \"windows\";\n";

  assert.deepEqual(await inlineScriptHashes(windowsHtml), [
    `sha256-${createHash("sha256").update(normalizedScript).digest("base64")}`
  ]);
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
  assert.equal(policy.entrypoint, "index.html");
  assert.ok(policy.runtimePaths.includes("index.html"));
  assert.ok(policy.runtimePaths.includes("game/src/value.js"));
  assert.ok(!policy.runtimePaths.includes("drydock-artifact.json"));
  const inlineScript = "\n{\"imports\":{\"fixture\":\"./game/src/value.js\"}}\n";
  assert.deepEqual(policy.scriptHashes, [
    `sha256-${createHash("sha256").update(inlineScript).digest("base64")}`
  ]);
});

test("staged Electron policy preserves a custom entrypoint", async (context) => {
  const state = await createElectronState(context, {
    entrypoint: "ui/start.html"
  });
  const {
    createRuntimeComposition,
    stageRuntime
  } = await import("../../../../../tools/composition.js");
  const composition = await createRuntimeComposition(state.verified);
  const stageDir = join(
    state.fixture.projectRoot,
    "artifacts/tmp/electron-stage/custom"
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

  const policy = JSON.parse(
    await readFile(join(stageDir, "runtime-policy.json"), "utf8")
  );
  assert.equal(policy.entrypoint, "ui/start.html");
  assert.ok(policy.runtimePaths.includes("ui/start.html"));
  await stat(join(stageDir, "runtime/ui/start.html"));
  await assert.rejects(stat(join(stageDir, "runtime/index.html")), {
    code: "ENOENT"
  });
});

test("staged Electron policy hashes every served HTML document", async (context) => {
  const secondaryScript = "\nwindow.secondaryPage = true;\n";
  const state = await createElectronState(context, {
    secondaryHtml: [
      "<!doctype html>",
      "<script>",
      "window.secondaryPage = true;",
      "</script>",
      ""
    ].join("\n")
  });
  const {
    createRuntimeComposition,
    stageRuntime
  } = await import("../../../../../tools/composition.js");
  const composition = await createRuntimeComposition(state.verified);
  const stageDir = join(
    state.fixture.projectRoot,
    "artifacts/tmp/electron-stage/multi-page"
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

  const policy = JSON.parse(
    await readFile(join(stageDir, "runtime-policy.json"), "utf8")
  );
  const entrypointScript = "\n{\"imports\":{\"fixture\":\"./game/src/value.js\"}}\n";
  assert.ok(policy.runtimePaths.includes("game/src/secondary.html"));
  assert.deepEqual(policy.scriptHashes, [
    entrypointScript,
    secondaryScript
  ].map((script) => (
    `sha256-${createHash("sha256").update(script).digest("base64")}`
  )).sort());
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

  assert.equal(manifest.schemaVersion, 3);
  assert.equal(manifest.releasable, false);
  assert.equal(manifest.buildAdapter, "electron");
  assert.equal(manifest.platform, "linux");
  assert.equal(manifest.arch, "x64");
  assert.equal(manifest.artifactRoot, "linux-unpacked");
  assert.equal(manifest.executable, "linux-unpacked/fixture-game");
  assert.equal(manifest.productId, "fixture-game");
  assert.equal(manifest.buildNumber, 9);
  assert.deepEqual(manifest.capabilities, ["storage"]);
  assert.equal(manifest.extensions.drydock.entrypoint, "index.html");
  assert.match(
    manifest.provenance.project.commit,
    /^[a-f0-9]{40}$/
  );
  assert.equal(
    manifest.provenance.project.descriptor.path,
    "shipping/drydock-project.json"
  );
  assert.equal(manifest.provenance.adapter.profile, "development");
  assert.equal(manifest.provenance.channelPolicy, null);
  assert.equal(manifest.extensions.electron.protocol, "app://drydock");
  assert.equal(
    output.value,
    "built Electron artifact: artifacts/build/linux-x64\n"
  );
});

test("Electron build rejects a symlinked output ancestor", async (context) => {
  const state = await createElectronState(context);
  const external = await mkdtemp(join(tmpdir(), "drydock-electron-external-"));
  context.after(() => rm(external, {
    force: true,
    recursive: true
  }));
  await mkdir(join(external, "linux-x64"));
  await mkdir(join(state.fixture.projectRoot, "artifacts"));
  await symlink(
    external,
    join(state.fixture.projectRoot, "artifacts", "linked-output"),
    "dir"
  );

  await assert.rejects(
    buildElectron({
      context: state.context,
      options: {
        arch: "x64",
        out: "artifacts/linked-output/linux-x64",
        platform: "linux",
        profile: "development",
        release: "shipping/releases/0.1.0.yaml",
        skipPackage: true
      },
      verified: state.verified
    }),
    /build output path must not contain symbolic links/
  );
  await assert.rejects(
    stat(join(
      state.fixture.projectRoot,
      "artifacts/tmp/electron-stage/linux-x64"
    )),
    {
      code: "ENOENT"
    }
  );
});

test("Electron build rejects output inside its transient stage", async (context) => {
  const state = await createElectronState(context);

  await assert.rejects(
    buildElectron({
      context: state.context,
      options: {
        arch: "x64",
        out: "artifacts/tmp/electron-stage/linux-x64/output",
        platform: "linux",
        profile: "development",
        release: "shipping/releases/0.1.0.yaml",
        skipPackage: true
      },
      verified: state.verified
    }),
    /build output must not overlap transient Electron storage/
  );
  await assert.rejects(
    stat(join(
      state.fixture.projectRoot,
      "artifacts/tmp/electron-stage/linux-x64"
    )),
    {
      code: "ENOENT"
    }
  );
});

test("Electron build rejects host capabilities it cannot provide", async (context) => {
  const state = await createElectronState(context, {
    requiredCapabilities: [
      "storage",
      "achievements"
    ]
  });

  await assert.rejects(
    buildElectron({
      context: state.context,
      options: {
        arch: "x64",
        platform: "linux",
        profile: "development",
        release: "shipping/releases/0.1.0.yaml",
        skipPackage: true
      },
      verified: state.verified
    }),
    /Electron host does not provide required capabilities: achievements/
  );
});

test("Electron release preflight fails before staging or output", async (context) => {
  const state = await createElectronState(context);
  const stageDir = join(
    state.fixture.projectRoot,
    "artifacts/tmp/electron-stage/linux-x64"
  );
  const outDir = join(
    state.fixture.projectRoot,
    "artifacts/build/release-preflight"
  );

  await assert.rejects(
    buildElectron({
      context: state.context,
      options: {
        arch: "x64",
        out: "artifacts/build/release-preflight",
        platform: "linux",
        profile: "release",
        release: "shipping/releases/0.1.0.yaml"
      },
      verified: {
        ...state.verified,
        profile: "release"
      }
    }),
    /Drydock at the project drydock\/ gitlink/
  );
  await assert.rejects(stat(stageDir), {
    code: "ENOENT"
  });
  await assert.rejects(stat(outDir), {
    code: "ENOENT"
  });
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

async function createElectronState(context, {
  entrypoint = "index.html",
  requiredCapabilities = [
    "storage"
  ],
  secondaryHtml = null
} = {}) {
  const {
    createMinimalProject,
    harnessRoot,
    loadMinimalVerifiedProject
  } = await import("../../../../../test/support/minimal-project.js");
  const fixture = await createMinimalProject(
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
      if (entrypoint !== "index.html") {
        await writeFile(
          join(gameRoot, "start.html"),
          "<!doctype html><title>Custom entrypoint</title>\n"
        );
      }
      if (secondaryHtml !== null) {
        await writeFile(
          join(gameRoot, "src", "secondary.html"),
          secondaryHtml
        );
      }
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
