const assert = require("node:assert/strict");
const { mkdtemp, readFile, stat } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const test = require("node:test");
const {
  artifactRootForTarget,
  buildElectron,
  executableForTarget,
  parseArgs,
  prepareStagedApp,
  resolveBuildTarget
} = require("../build.js");

test("parses Electron build arguments", () => {
  assert.deepEqual(parseArgs([
    "--release",
    "release.yaml",
    "--out",
    "artifacts/tmp/test",
    "--platform",
    "win32",
    "--arch",
    "x64",
    "--build-key",
    "steam"
  ]), {
    release: "release.yaml",
    out: "artifacts/tmp/test",
    platform: "win32",
    arch: "x64",
    buildKey: "steam"
  });

  assert.throws(() => parseArgs(["--arch"]), /--arch requires/);
  assert.throws(() => parseArgs(["--unknown"]), /unknown argument/);
});

test("normalizes Electron build targets and output paths", () => {
  assert.deepEqual(resolveBuildTarget({ platform: "win32", arch: "x64" }), {
    platform: "windows",
    arch: "x64"
  });
  assert.deepEqual(resolveBuildTarget({ platform: "darwin", arch: "arm64" }), {
    platform: "macos",
    arch: "arm64"
  });

  assert.equal(artifactRootForTarget({ platform: "linux", arch: "x64" }), "linux-unpacked");
  assert.equal(executableForTarget({ platform: "windows", arch: "x64" }), "win-unpacked/line-engine-calibration.exe");
  assert.throws(() => resolveBuildTarget({ platform: "freebsd", arch: "x64" }), /unsupported/);
});

test("stages Electron shell and composed product without repo-only files", async () => {
  const stageDir = await mkdtemp(join(tmpdir(), "drydock-electron-stage-"));

  await prepareStagedApp({
    stageDir,
    release: { version: "0.1.0" }
  });

  await stat(join(stageDir, "main.js"));
  await stat(join(stageDir, "preload.js"));
  await stat(join(stageDir, "protocol.js"));
  await stat(join(stageDir, "host-provider.js"));
  await stat(join(stageDir, "runtime/index.html"));
  await stat(join(stageDir, "runtime/vendor/drydock-host-bridge/index.js"));
  await stat(join(stageDir, "runtime/product/mock-game/index.html"));
  await stat(join(stageDir, "runtime/product/mock-game/src/bootstrap.js"));
  await stat(join(stageDir, "runtime/product/mock-game/src/platform-host.js"));
  await stat(join(stageDir, "runtime/product/mock-game/style/mock.css"));
  await stat(join(stageDir, "runtime/product/src/core/scope.js"));
  await stat(join(stageDir, "runtime/product/style/hud.css"));
  await stat(join(stageDir, "runtime/product/lib/three.module.js"));

  await assert.rejects(stat(join(stageDir, "runtime/product/package.json")), { code: "ENOENT" });
  await assert.rejects(stat(join(stageDir, "runtime/product/AGENTS.md")), { code: "ENOENT" });
  await assert.rejects(
    stat(join(stageDir, "runtime/product/drydock-product.json")),
    { code: "ENOENT" }
  );

  const stagedPackage = JSON.parse(await readFile(join(stageDir, "package.json"), "utf8"));
  assert.equal(stagedPackage.main, "main.js");
  assert.equal(stagedPackage.type, "commonjs");
});

test("Electron build emits a schema-valid artifact manifest", async () => {
  const out = await mkdtemp(join(tmpdir(), "drydock-electron-out-"));
  const { manifest } = await buildElectron({
    release: "contracts/releases/0.1.0.yaml",
    out,
    platform: "linux",
    arch: "x64",
    skipPackage: true
  });

  await stat(join(out, "linux-unpacked/line-engine-calibration"));
  await stat(join(out, "drydock-artifact.json"));

  assert.equal(manifest.schemaVersion, 2);
  assert.equal(manifest.buildAdapter, "electron");
  assert.equal(manifest.platform, "linux");
  assert.equal(manifest.arch, "x64");
  assert.equal(manifest.artifactRoot, "linux-unpacked");
  assert.equal(manifest.executable, "linux-unpacked/line-engine-calibration");
  assert.equal(manifest.productId, "line-engine-calibration");
  assert.equal(manifest.buildNumber, 100);
  assert.deepEqual(manifest.capabilities, ["storage"]);
  assert.equal(manifest.extensions.drydock.entrypoint, "product/mock-game/index.html");
  assert.match(manifest.extensions.drydock.productRevision.commit, /^[a-f0-9]{40}$/);
  assert.equal(manifest.extensions.electron.protocol, "app://drydock");
});
