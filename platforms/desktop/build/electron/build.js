#!/usr/bin/env node
const { createHash } = require("node:crypto");
const { spawn } = require("node:child_process");
const { cp, mkdir, readdir, readFile, rm, stat, writeFile } = require("node:fs/promises");
const { dirname, join, relative, resolve } = require("node:path");
const Ajv2020 = require("ajv/dist/2020");
const YAML = require("yaml");

const repoRoot = resolve(__dirname, "../../../..");
const packageRoot = __dirname;
const defaultRelease = "releases/1.4.0.yaml";
const defaultBuildKey = "desktop";
const productName = "Drydock Payload";
const executableName = "drydock-placeholder";
const bundleId = "dev.drydock.placeholder";
const runtimeEntries = [
  "index.html",
  "host-bridge.js",
  "src",
  "vendor",
  "assets"
];

if (require.main === module) {
  buildElectron(parseArgs(process.argv.slice(2))).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

async function buildElectron(options = {}) {
  const target = resolveBuildTarget(options);
  const releasePath = resolve(repoRoot, options.release ?? defaultRelease);
  const outDir = resolve(repoRoot, options.out ?? join("out", `${target.platform}-${target.arch}`));
  const stageDir = resolve(repoRoot, "out", ".electron-stage", `${target.platform}-${target.arch}`);
  const release = YAML.parse(await readFile(releasePath, "utf8"));
  const buildKey = options.buildKey ?? defaultBuildKey;
  const buildNumber = release?.build?.[buildKey];

  if (!Number.isInteger(buildNumber)) {
    throw new Error(`release manifest does not define build.${buildKey}`);
  }

  await rm(outDir, { recursive: true, force: true });
  await rm(stageDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });
  await prepareStagedApp({ stageDir, release });

  if (!options.skipPackage) {
    await runElectronBuilder({ stageDir, outDir, target });
  } else {
    await createFakeUnpackedOutput({ outDir, target });
  }

  await rm(stageDir, { recursive: true, force: true });

  const artifactRoot = artifactRootForTarget(target);
  await assertDirectory(resolve(outDir, artifactRoot));

  const manifest = await createArtifactManifest({
    artifactRoot,
    buildKey,
    buildNumber,
    outDir,
    release,
    releasePath,
    target
  });

  await validateArtifactManifest(manifest);
  await writeFile(
    resolve(outDir, "drydock-artifact.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  );

  console.log(`built Electron artifact: ${relative(repoRoot, outDir)}`);
  return { outDir, manifest };
}

async function prepareStagedApp({ stageDir, release }) {
  await mkdir(stageDir, { recursive: true });

  for (const file of ["main.js", "preload.js", "protocol.js", "host-provider.js"]) {
    await cp(resolve(packageRoot, file), resolve(stageDir, file));
  }

  await writeFile(
    resolve(stageDir, "package.json"),
    `${JSON.stringify(createStagedPackage(release), null, 2)}\n`
  );

  const copied = [];

  for (const entry of runtimeEntries) {
    const source = resolve(repoRoot, "game", entry);

    if (!(await exists(source))) {
      continue;
    }

    await cp(source, resolve(stageDir, "game", entry), { recursive: true, dereference: true });
    copied.push(entry);
  }

  return { copied };
}

function createStagedPackage(release) {
  return {
    name: "drydock-placeholder-electron-app",
    version: String(release.version),
    description: "Drydock placeholder payload wrapped by the Electron build adapter.",
    author: "Drydock",
    private: true,
    type: "commonjs",
    main: "main.js",
    productName
  };
}

async function runElectronBuilder({ stageDir, outDir, target }) {
  const args = [
    "--dir",
    "--projectDir",
    stageDir,
    "--config",
    resolve(packageRoot, "builder.base.yml"),
    `--${builderPlatformFlag(target.platform)}`,
    `--${target.arch}`,
    `-c.electronVersion=${electronVersion()}`,
    `-c.directories.output=${outDir}`,
    "--publish",
    "never"
  ];

  await run("electron-builder", args);
}

function resolveBuildTarget(options = {}) {
  const platform = normalizePlatform(options.platform ?? process.platform);
  const arch = normalizeArch(options.arch ?? process.arch);

  return { platform, arch };
}

function normalizePlatform(value) {
  const normalized = String(value).toLowerCase();

  if (normalized === "win32" || normalized === "windows" || normalized === "win") {
    return "windows";
  }

  if (normalized === "darwin" || normalized === "macos" || normalized === "mac") {
    return "macos";
  }

  if (normalized === "linux") {
    return "linux";
  }

  throw new Error(`unsupported Electron platform: ${value}`);
}

function normalizeArch(value) {
  const normalized = String(value).toLowerCase();

  if (normalized === "x64" || normalized === "arm64") {
    return normalized;
  }

  throw new Error(`unsupported Electron arch: ${value}`);
}

function builderPlatformFlag(platform) {
  if (platform === "windows") {
    return "win";
  }

  if (platform === "macos") {
    return "mac";
  }

  return platform;
}

function artifactRootForTarget(target) {
  if (target.platform === "windows") {
    return "win-unpacked";
  }

  if (target.platform === "macos") {
    return join("mac", `${productName}.app`);
  }

  return "linux-unpacked";
}

function executableForTarget(target) {
  if (target.platform === "windows") {
    return join("win-unpacked", `${executableName}.exe`);
  }

  if (target.platform === "macos") {
    return join("mac", `${productName}.app`, "Contents", "MacOS", executableName);
  }

  return join("linux-unpacked", executableName);
}

async function createArtifactManifest({ artifactRoot, buildKey, buildNumber, outDir, release, releasePath, target }) {
  const artifactRootPath = resolve(outDir, artifactRoot);
  const checksums = [];

  for (const filePath of await listFiles(artifactRootPath)) {
    const path = relative(outDir, filePath)
      .split("\\")
      .join("/");
    const value = createHash("sha256").update(await readFile(filePath)).digest("hex");
    checksums.push({ path, algorithm: "sha256", value });
  }

  checksums.sort((a, b) => a.path.localeCompare(b.path));

  return {
    schemaVersion: 1,
    gameId: "drydock-placeholder",
    version: String(release.version),
    buildNumber,
    engine: "electron",
    platform: target.platform,
    arch: target.arch,
    artifactRoot: artifactRoot.split("\\").join("/"),
    executable: executableForTarget(target).split("\\").join("/"),
    bundleId,
    packageId: null,
    signing: {
      status: "unsigned"
    },
    capabilities: [
      "storage"
    ],
    checksums,
    extensions: {
      drydock: {
        buildAdapter: "@drydock/desktop-electron",
        buildKey,
        release: relative(repoRoot, releasePath).split("\\").join("/")
      },
      electron: {
        builder: "electron-builder",
        productName,
        executableName,
        protocol: "app://drydock"
      }
    }
  };
}

async function validateArtifactManifest(manifest) {
  const schema = JSON.parse(
    await readFile(resolve(repoRoot, "schemas/drydock-artifact.schema.json"), "utf8")
  );
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);

  if (!validate(manifest)) {
    throw new Error(`invalid artifact manifest: ${JSON.stringify(validate.errors, null, 2)}`);
  }
}

function parseArgs(argv) {
  const options = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--") {
      continue;
    } else if (arg === "--release") {
      options.release = requireValue(argv, ++i, arg);
    } else if (arg === "--out") {
      options.out = requireValue(argv, ++i, arg);
    } else if (arg === "--platform") {
      options.platform = requireValue(argv, ++i, arg);
    } else if (arg === "--arch") {
      options.arch = requireValue(argv, ++i, arg);
    } else if (arg === "--build-key") {
      options.buildKey = requireValue(argv, ++i, arg);
    } else if (arg === "--skip-package") {
      options.skipPackage = true;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return options;
}

async function createFakeUnpackedOutput({ outDir, target }) {
  const artifactRoot = resolve(outDir, artifactRootForTarget(target));
  await mkdir(dirname(resolve(outDir, executableForTarget(target))), { recursive: true });
  await mkdir(artifactRoot, { recursive: true });
  await writeFile(resolve(outDir, executableForTarget(target)), "fake executable\n");
}

async function run(command, args) {
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: packageRoot,
      stdio: "inherit",
      shell: process.platform === "win32"
    });

    child.on("error", rejectRun);
    child.on("exit", (code) => {
      if (code === 0) {
        resolveRun();
      } else {
        rejectRun(new Error(`${command} exited with code ${code}`));
      }
    });
  });
}

async function assertDirectory(path) {
  const info = await stat(path);

  if (!info.isDirectory()) {
    throw new Error(`artifact root is not a directory: ${path}`);
  }
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function listFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...await listFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }

  return files;
}

function requireValue(argv, index, flag) {
  const value = argv[index];

  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }

  return value;
}

function electronVersion() {
  return require("electron/package.json").version;
}

module.exports = {
  artifactRootForTarget,
  buildElectron,
  createArtifactManifest,
  createStagedPackage,
  executableForTarget,
  normalizeArch,
  normalizePlatform,
  parseArgs,
  prepareStagedApp,
  resolveBuildTarget,
  electronVersion
};
