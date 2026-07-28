#!/usr/bin/env node
const { createHash } = require("node:crypto");
const { spawn } = require("node:child_process");
const {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  stat,
  writeFile
} = require("node:fs/promises");
const {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep
} = require("node:path");
const { pathToFileURL } = require("node:url");
const YAML = require("yaml");
const {
  ELECTRON_HOST_CAPABILITIES
} = require("./host-provider.js");

const packageRoot = __dirname;
const defaultBuildKey = "desktop";

if (require.main === module) {
  import(pathToFileURL(resolve(packageRoot, "../../../../tools/drydock.js")).href)
    .then(({ runCli }) => runCli(
      [
        "build",
        "electron",
        ...process.argv.slice(2)
      ],
      {
        invocationCwd: process.cwd()
      }
    ))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .catch((error) => {
      console.error(error.message);
      process.exitCode = 1;
    });
}

async function buildElectronCommand({
  args,
  context,
  stderr,
  stdout
}) {
  let options;
  try {
    options = parseArgs(args);
  } catch (error) {
    stderr.write(`ERROR: ${error.message}\n`);
    return 2;
  }

  const {
    loadProject,
    verifyProjectComponents
  } = await loadProjectTools();
  const project = await loadProject(context);
  const verified = await verifyProjectComponents(project, {
    profile: options.profile
  });
  await buildElectron({
    context,
    options,
    stdout,
    verified
  });
  return 0;
}

async function buildElectron({
  context,
  options,
  stdout = process.stdout,
  verified
}) {
  if (!context || !verified) {
    throw new TypeError("context and verified project are required");
  }
  if (
    verified.project.context.projectPath !== context.projectPath
    || verified.profile !== options.profile
  ) {
    throw new TypeError("verified project does not match the build context and profile");
  }

  const {
    createArtifactProvenance,
    createRuntimeComposition,
    resolveProjectPath,
    stageRuntime,
    validateArtifactManifest
  } = await loadBuildTools();
  const target = resolveBuildTarget(options);
  const identity = identityFromDescriptor(verified.project.descriptor);
  assertRequiredHostCapabilities(
    verified.project.descriptor.host.requiredCapabilities
  );
  const releasePath = await resolveReleasePath(
    context,
    options.release,
    resolveProjectPath
  );
  const outDir = resolveProjectPath(
    context,
    options.out
      ?? join("artifacts", "build", `${target.platform}-${target.arch}`),
    "build output"
  );
  const stageDir = resolve(
    context.artifactRoot,
    "tmp",
    "electron-stage",
    `${target.platform}-${target.arch}`
  );
  if (pathsOverlap(outDir, stageDir)) {
    throw new Error("build output must not overlap the transient Electron stage");
  }
  const release = YAML.parse(await readFile(releasePath, "utf8"));
  const buildKey = options.buildKey ?? defaultBuildKey;
  const buildNumber = release?.build?.[buildKey];

  if (
    typeof release?.version !== "string"
    && typeof release?.version !== "number"
  ) {
    throw new Error("release manifest must define version");
  }
  if (!Number.isInteger(buildNumber)) {
    throw new Error(`release manifest does not define build.${buildKey}`);
  }

  const composition = await createRuntimeComposition(verified);
  try {
    await prepareStagedApp({
      composition,
      identity,
      release,
      stageDir,
      stageRuntime
    });
    await prepareEmptyOutputDirectory(context, outDir);

    if (!options.skipPackage) {
      await runElectronBuilder({
        identity,
        outDir,
        stageDir,
        target
      });
    } else {
      await createFakeUnpackedOutput({
        identity,
        outDir,
        target
      });
    }

    const artifactRoot = artifactRootForTarget(target, identity);
    await assertDirectory(resolve(outDir, artifactRoot));

    const provenance = await createArtifactProvenance({
      adapter: {
        id: "electron",
        package: "@drydock/desktop-electron"
      },
      releasePath,
      verified
    });
    const manifest = await createArtifactManifest({
      artifactRoot,
      buildKey,
      buildNumber,
      identity,
      outDir,
      provenance,
      release,
      target,
      verified
    });

    await validateArtifactManifest(manifest, context.harnessRoot);
    await writeFile(
      resolve(outDir, "drydock-artifact.json"),
      `${JSON.stringify(manifest, null, 2)}\n`
    );

    stdout.write(
      `built Electron artifact: ${portableRelative(context.projectRoot, outDir)}\n`
    );
    return {
      manifest,
      outDir
    };
  } finally {
    await rm(stageDir, {
      force: true,
      recursive: true
    });
  }
}

async function prepareStagedApp({
  composition,
  identity,
  release,
  stageDir,
  stageRuntime
}) {
  if (!composition || typeof stageRuntime !== "function") {
    throw new TypeError("composition and stageRuntime are required");
  }

  const runtimeRoot = resolve(stageDir, "runtime");
  await stageRuntime(composition, runtimeRoot);

  for (const file of [
    "host-provider.js",
    "main.js",
    "preload.js",
    "protocol.js"
  ]) {
    await cp(resolve(packageRoot, file), resolve(stageDir, file));
  }

  await writeFile(
    resolve(stageDir, "package.json"),
    `${JSON.stringify(createStagedPackage(release, identity), null, 2)}\n`
  );
  await writeFile(
    resolve(stageDir, "runtime-policy.json"),
    `${JSON.stringify(await createRuntimePolicy(
      runtimeRoot,
      composition.entrypoint
    ), null, 2)}\n`
  );

  return {
    entrypoint: composition.entrypoint
  };
}

function createStagedPackage(release, identity) {
  return {
    name: `${identity.executableName}-electron-app`,
    version: String(release.version),
    description: `${identity.productName} wrapped by the Drydock Electron adapter.`,
    author: "Drydock",
    private: true,
    type: "commonjs",
    main: "main.js",
    productName: identity.productName
  };
}

async function createRuntimePolicy(runtimeRoot, entrypoint) {
  const runtimeFiles = await listFiles(runtimeRoot);
  const runtimePaths = runtimeFiles
    .map((filePath) => portableRelative(runtimeRoot, filePath))
    .sort();
  const scriptHashes = await runtimeScriptHashes(runtimeFiles);

  return {
    entrypoint,
    runtimePaths,
    scriptHashes
  };
}

async function runtimeScriptHashes(runtimeFiles) {
  const hashes = new Set();

  for (const filePath of runtimeFiles) {
    if (extname(filePath).toLowerCase() !== ".html") {
      continue;
    }

    for (const hash of inlineScriptHashes(await readFile(filePath, "utf8"))) {
      hashes.add(hash);
    }
  }

  return [...hashes].sort();
}

function inlineScriptHashes(html) {
  const hashes = new Set();
  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  const normalizedHtml = html.replace(/\r\n?/g, "\n");
  let match;

  while ((match = scriptPattern.exec(normalizedHtml)) !== null) {
    if (/\ssrc\s*=/i.test(match[1])) {
      continue;
    }

    hashes.add(
      `sha256-${createHash("sha256").update(match[2]).digest("base64")}`
    );
  }

  return [...hashes].sort();
}

async function runElectronBuilder({
  identity,
  outDir,
  runCommand = run,
  stageDir,
  target
}) {
  const args = [
    "--dir",
    "--projectDir",
    stageDir,
    "--config",
    resolve(packageRoot, "builder.base.yml"),
    `--${builderPlatformFlag(target.platform)}`,
    `--${target.arch}`,
    `-c.electronVersion=${electronVersion()}`,
    `-c.appId=${identity.bundleId}`,
    `-c.productName=${identity.productName}`,
    `-c.executableName=${identity.executableName}`,
    `-c.directories.output=${outDir}`,
    "--publish",
    "never"
  ];

  await runCommand(
    process.execPath,
    [
      require.resolve("electron-builder/cli.js"),
      ...args
    ]
  );
}

function resolveBuildTarget(options = {}) {
  const platform = normalizePlatform(options.platform ?? process.platform);
  const arch = normalizeArch(options.arch ?? process.arch);

  return {
    arch,
    platform
  };
}

function normalizePlatform(value) {
  const normalized = String(value).toLowerCase();

  if (
    normalized === "win32"
    || normalized === "windows"
    || normalized === "win"
  ) {
    return "windows";
  }

  if (
    normalized === "darwin"
    || normalized === "macos"
    || normalized === "mac"
  ) {
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

function artifactRootForTarget(target, identity) {
  if (target.platform === "windows") {
    return "win-unpacked";
  }

  if (target.platform === "macos") {
    return join("mac", `${identity.productName}.app`);
  }

  return "linux-unpacked";
}

function executableForTarget(target, identity) {
  if (target.platform === "windows") {
    return join("win-unpacked", `${identity.executableName}.exe`);
  }

  if (target.platform === "macos") {
    return join(
      "mac",
      `${identity.productName}.app`,
      "Contents",
      "MacOS",
      identity.executableName
    );
  }

  return join("linux-unpacked", identity.executableName);
}

async function createArtifactManifest({
  artifactRoot,
  buildKey,
  buildNumber,
  identity,
  outDir,
  provenance,
  release,
  target,
  verified
}) {
  const artifactRootPath = resolve(outDir, artifactRoot);
  const checksums = [];

  for (const filePath of await listFiles(artifactRootPath)) {
    const path = portableRelative(outDir, filePath);
    const value = createHash("sha256")
      .update(await readFile(filePath))
      .digest("hex");
    checksums.push({
      algorithm: "sha256",
      path,
      value
    });
  }

  checksums.sort((left, right) => left.path.localeCompare(right.path));

  return {
    schemaVersion: 3,
    releasable: verified.profile === "release",
    productId: identity.productId,
    version: String(release.version),
    buildNumber,
    buildAdapter: "electron",
    platform: target.platform,
    arch: target.arch,
    artifactRoot: portablePath(artifactRoot),
    executable: portablePath(executableForTarget(target, identity)),
    bundleId: identity.bundleId,
    packageId: null,
    signing: {
      status: "unsigned"
    },
    capabilities: [
      ...verified.project.descriptor.host.requiredCapabilities
    ],
    checksums,
    provenance,
    extensions: {
      drydock: {
        buildKey,
        entrypoint: verified.project.descriptor.runtime.entrypoint
      },
      electron: {
        builder: "electron-builder",
        executableName: identity.executableName,
        productName: identity.productName,
        protocol: "app://drydock"
      }
    }
  };
}

function identityFromDescriptor(descriptor) {
  return {
    bundleId: descriptor.product.appId,
    executableName: descriptor.product.executableName,
    productId: descriptor.product.id,
    productName: descriptor.product.name
  };
}

function parseArgs(argv) {
  const options = {
    profile: "release"
  };
  const seen = new Set();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--release") {
      rejectDuplicate(seen, argument);
      options.release = requireValue(argv, ++index, argument);
    } else if (argument === "--out") {
      rejectDuplicate(seen, argument);
      options.out = requireValue(argv, ++index, argument);
    } else if (argument === "--platform") {
      rejectDuplicate(seen, argument);
      options.platform = requireValue(argv, ++index, argument);
    } else if (argument === "--arch") {
      rejectDuplicate(seen, argument);
      options.arch = requireValue(argv, ++index, argument);
    } else if (argument === "--build-key") {
      rejectDuplicate(seen, argument);
      options.buildKey = requireValue(argv, ++index, argument);
    } else if (argument === "--profile") {
      rejectDuplicate(seen, argument);
      options.profile = requireValue(argv, ++index, argument);
      if (
        options.profile !== "development"
        && options.profile !== "release"
      ) {
        throw new Error("--profile must be development or release");
      }
    } else if (argument === "--skip-package") {
      rejectDuplicate(seen, argument);
      options.skipPackage = true;
    } else {
      throw new Error(`unknown Electron argument: ${argument}`);
    }
  }

  if (!options.release) {
    throw new Error("--release is required");
  }
  if (options.skipPackage && options.profile !== "development") {
    throw new Error("--skip-package requires --profile development");
  }

  return options;
}

function rejectDuplicate(seen, flag) {
  if (seen.has(flag)) {
    throw new Error(`${flag} may be provided only once`);
  }
  seen.add(flag);
}

function assertRequiredHostCapabilities(requiredCapabilities) {
  const unsupported = requiredCapabilities.filter((capability) => (
    capability === "storage"
      ? ELECTRON_HOST_CAPABILITIES.storage === "none"
      : ELECTRON_HOST_CAPABILITIES[capability] !== true
  ));

  if (unsupported.length > 0) {
    throw new Error(
      `Electron host does not provide required capabilities: ${unsupported.join(", ")}`
    );
  }
}

async function createFakeUnpackedOutput({
  identity,
  outDir,
  target
}) {
  const artifactRoot = resolve(
    outDir,
    artifactRootForTarget(target, identity)
  );
  await mkdir(
    dirname(resolve(outDir, executableForTarget(target, identity))),
    {
      recursive: true
    }
  );
  await mkdir(artifactRoot, {
    recursive: true
  });
  await writeFile(
    resolve(outDir, executableForTarget(target, identity)),
    "fake executable\n"
  );
}

async function resolveReleasePath(context, value, resolveProjectPath) {
  const requestedPath = resolveProjectPath(context, value, "release");
  const releaseRoot = resolve(context.shippingRoot, "releases");
  let canonicalPath;

  try {
    canonicalPath = await realpath(requestedPath);
  } catch (error) {
    throw new Error(`cannot resolve release manifest: ${error.message}`);
  }

  if (
    canonicalPath === releaseRoot
    || !pathWithin(releaseRoot, canonicalPath)
  ) {
    throw new Error("release must resolve below shipping/releases");
  }

  return canonicalPath;
}

async function prepareEmptyOutputDirectory(context, outDir) {
  const artifactRoot = await realpath(context.artifactRoot);
  if (!pathWithin(artifactRoot, outDir)) {
    throw new Error("build output must be below the project artifact root");
  }

  let current = artifactRoot;
  const segments = relative(artifactRoot, outDir).split(sep);
  for (const segment of segments) {
    current = resolve(current, segment);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) {
        throw new Error("build output path must not contain symbolic links");
      }
      if (!info.isDirectory()) {
        throw new Error("build output parent is not a directory");
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      await mkdir(current);
    }

    const canonicalCurrent = await realpath(current);
    if (!pathAtOrWithin(artifactRoot, canonicalCurrent)) {
      throw new Error("build output resolves outside the project artifact root");
    }
  }

  const canonicalOutDir = await realpath(outDir);
  if (
    canonicalOutDir !== outDir
    || !pathWithin(artifactRoot, canonicalOutDir)
  ) {
    throw new Error("build output resolves outside the project artifact root");
  }

  if ((await readdir(outDir)).length > 0) {
    throw new Error("build output directory must be empty");
  }
}

async function run(command, args) {
  await new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: packageRoot,
      stdio: "inherit"
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

async function listFiles(root) {
  const entries = await readdir(root, {
    withFileTypes: true
  });
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

async function loadProjectTools() {
  const [
    components,
    project
  ] = await Promise.all([
    import(pathToFileURL(resolve(packageRoot, "../../../../tools/components.js")).href),
    import(pathToFileURL(resolve(packageRoot, "../../../../tools/project.js")).href)
  ]);
  return {
    loadProject: project.loadProject,
    verifyProjectComponents: components.verifyProjectComponents
  };
}

async function loadBuildTools() {
  const [
    artifacts,
    composition,
    drydock
  ] = await Promise.all([
    import(pathToFileURL(resolve(packageRoot, "../../../../tools/artifacts.js")).href),
    import(pathToFileURL(resolve(packageRoot, "../../../../tools/composition.js")).href),
    import(pathToFileURL(resolve(packageRoot, "../../../../tools/drydock.js")).href)
  ]);
  return {
    createArtifactProvenance: artifacts.createArtifactProvenance,
    createRuntimeComposition: composition.createRuntimeComposition,
    resolveProjectPath: drydock.resolveProjectPath,
    stageRuntime: composition.stageRuntime,
    validateArtifactManifest: artifacts.validateArtifactManifest
  };
}

function pathWithin(root, candidate) {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot !== ""
    && pathFromRoot !== ".."
    && !pathFromRoot.startsWith(`..${sep}`)
    && !isAbsolute(pathFromRoot)
  );
}

function pathAtOrWithin(root, candidate) {
  return candidate === root || pathWithin(root, candidate);
}

function pathsOverlap(left, right) {
  return pathAtOrWithin(left, right) || pathAtOrWithin(right, left);
}

function portableRelative(root, target) {
  return relative(root, target).split(sep).join("/");
}

function portablePath(path) {
  return path.split(sep).join("/");
}

function electronVersion() {
  return require("electron/package.json").version;
}

module.exports = {
  assertRequiredHostCapabilities,
  artifactRootForTarget,
  buildElectron,
  buildElectronCommand,
  createArtifactManifest,
  createRuntimePolicy,
  createStagedPackage,
  electronVersion,
  executableForTarget,
  inlineScriptHashes,
  normalizeArch,
  normalizePlatform,
  parseArgs,
  prepareStagedApp,
  resolveBuildTarget,
  runElectronBuilder
};
