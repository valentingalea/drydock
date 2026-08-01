#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import YAML from "yaml";
import {
  DEV_HOST_CAPABILITIES
} from "../../../../contracts/host-bridge/src/index.js";
import {
  createArtifactProvenance,
  loadChannelPolicy,
  validateArtifactManifest
} from "../../../../tools/artifacts.js";
import {
  createRuntimeComposition,
  stageRuntime
} from "../../../../tools/composition.js";
import { verifyProjectComponents } from "../../../../tools/components.js";
import {
  resolveProjectPath
} from "../../../../tools/context.js";
import { loadProject } from "../../../../tools/project.js";

const defaultChannel = "vps";
const defaultOut = "artifacts/build/web-static";

export async function buildStaticWebCommand({
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

  const project = await loadProject(context);
  const verified = await verifyProjectComponents(project, {
    profile: options.profile
  });
  await buildStaticWeb({
    context,
    options,
    stdout,
    verified
  });
  return 0;
}

export async function buildStaticWeb({
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

  assertRequiredHostCapabilities(
    verified.project.descriptor.host.requiredCapabilities
  );
  const releasePath = await resolveReleasePath(context, options.release);
  const outDir = resolveProjectPath(
    context,
    options.out ?? defaultOut,
    "build output"
  );
  const channel = options.channel ?? defaultChannel;
  const release = YAML.parse(await readFile(releasePath, "utf8"));
  const buildNumber = release?.build?.[channel];

  if (
    typeof release?.version !== "string"
    && typeof release?.version !== "number"
  ) {
    throw new Error("release manifest must define version");
  }
  if (!Number.isInteger(buildNumber)) {
    throw new Error(`release manifest does not define build.${channel}`);
  }

  const channelPolicy = await loadChannelPolicy({
    channel,
    context,
    value: options.channelPolicy
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
  const composition = await createRuntimeComposition(verified);
  await stageRuntime(composition, outDir);
  if (composition.entrypoint !== "index.html") {
    await writeFile(
      resolve(outDir, "index.html"),
      renderEntrypointRedirect(composition.entrypoint)
    );
  }

  const filePaths = await listFiles(outDir);
  const checksums = [];

  for (const filePath of filePaths) {
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

  const descriptor = verified.project.descriptor;
  const manifest = {
    schemaVersion: 3,
    releasable: verified.profile === "release",
    productId: descriptor.product.id,
    version: String(release.version),
    buildNumber,
    buildAdapter: "web-static",
    platform: "web",
    arch: "wasm",
    artifactRoot: ".",
    executable: null,
    bundleId: null,
    packageId: null,
    signing: {
      status: "unsigned"
    },
    capabilities: [...descriptor.host.requiredCapabilities],
    checksums,
    provenance,
    extensions: {
      drydock: {
        entrypoint: composition.entrypoint
      }
    }
  };

  await validateArtifactManifest(manifest, context.harnessRoot);
  await writeFile(
    resolve(outDir, "drydock-artifact.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  );

  stdout.write(
    `built static web artifact: ${portableRelative(context.projectRoot, outDir)}\n`
  );
  return {
    manifest,
    outDir
  };
}

export function parseArgs(argv) {
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
    } else if (argument === "--channel") {
      rejectDuplicate(seen, argument);
      options.channel = requireValue(argv, ++index, argument);
    } else if (argument === "--channel-policy") {
      rejectDuplicate(seen, argument);
      options.channelPolicy = requireValue(argv, ++index, argument);
    } else if (argument === "--profile") {
      rejectDuplicate(seen, argument);
      options.profile = requireValue(argv, ++index, argument);
      if (
        options.profile !== "development"
        && options.profile !== "release"
      ) {
        throw new Error(
          "--profile must be development or release"
        );
      }
    } else {
      throw new Error(`unknown web-static argument: ${argument}`);
    }
  }

  if (!options.release) {
    throw new Error("--release is required");
  }

  return options;
}

export function assertRequiredHostCapabilities(requiredCapabilities) {
  const unsupported = requiredCapabilities.filter((capability) => (
    capability === "storage"
      ? DEV_HOST_CAPABILITIES.storage === "none"
      : DEV_HOST_CAPABILITIES[capability] !== true
  ));

  if (unsupported.length > 0) {
    throw new Error(
      `web-static host does not provide required capabilities: ${unsupported.join(", ")}`
    );
  }
}

function rejectDuplicate(seen, flag) {
  if (seen.has(flag)) {
    throw new Error(`${flag} may be provided only once`);
  }
  seen.add(flag);
}

function requireValue(argv, index, flag) {
  const value = argv[index];

  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }

  return value;
}

async function resolveReleasePath(context, value) {
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

function pathWithin(root, candidate) {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot !== ""
    && pathFromRoot !== ".."
    && !pathFromRoot.startsWith(`..${sep}`)
    && !isAbsolute(pathFromRoot)
  );
}

function portableRelative(root, target) {
  return relative(root, target).split(sep).join("/");
}

function renderEntrypointRedirect(entrypoint) {
  const target = entrypoint
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");

  return [
    "<!doctype html>",
    "<html lang=\"en\">",
    "  <head>",
    "    <meta charset=\"utf-8\">",
    `    <meta http-equiv="refresh" content="0; url=${target}">`,
    `    <link rel="canonical" href="${target}">`,
    "    <title>Launching game</title>",
    "  </head>",
    "  <body>",
    `    <p><a href="${target}">Launch the game</a></p>`,
    "  </body>",
    "</html>",
    ""
  ].join("\n");
}

if (
  process.argv[1]
  && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { runCli } = await import("../../../../tools/drydock.js");
  process.exitCode = await runCli(
    [
      "build",
      "web-static",
      ...process.argv.slice(2)
    ],
    {
      invocationCwd: process.cwd()
    }
  );
}
