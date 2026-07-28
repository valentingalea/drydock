#!/usr/bin/env node
import {
  cp,
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile
} from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveArtifactPayloadRoot,
  resolveArtifactManifestPath,
  validateArtifactManifest,
  verifyArtifactChecksums
} from "../../../../tools/artifacts.js";
import { isDirectInvocation } from "../../../../tools/drydock.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

if (isDirectInvocation(import.meta.url, process.argv[1])) {
  const { runCli } = await import("../../../../tools/drydock.js");
  process.exitCode = await runCli([
    "publish",
    "vps",
    ...process.argv.slice(2)
  ], {
    invocationCwd: process.cwd()
  });
}

export async function publishVpsCommand({
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

  await publishVps({
    context,
    options,
    stdout
  });
  return 0;
}

export async function publishVps({
  context,
  env = process.env,
  options,
  stdout = process.stdout
}) {
  if (!context) {
    throw new TypeError("project context is required");
  }

  const manifestPath = await resolveArtifactManifestPath(
    context,
    options.artifact
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  await validateManifest(manifest);
  await verifyArtifactChecksums(manifest, manifestPath);

  const artifactRoot = await resolveArtifactPayloadRoot(manifest, manifestPath);
  const rootBase = await resolveOperationalRoot(
    options.root ?? env.DRYDOCK_VPS_ROOT
  );
  const deploymentId = deploymentIdFromManifest(manifest);
  const root = resolve(rootBase, deploymentId);

  if (options.dryRun) {
    stdout.write(`would deploy ${artifactRoot} -> ${root}\n`);
    return {
      artifactRoot,
      deploymentId,
      dryRun: true,
      root
    };
  }

  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  await cp(artifactRoot, root, { recursive: true, dereference: true });
  await writeFile(resolve(root, ".drydock-channel"), "vps\n");

  stdout.write(`deployed static web artifact: ${artifactRoot} -> ${root}\n`);
  return {
    artifactRoot,
    deploymentId,
    dryRun: false,
    root
  };
}

export function parseArgs(argv) {
  const options = {};
  const seen = new Set();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];

    if (argument === "--artifact") {
      rejectDuplicate(seen, argument);
      options.artifact = requireValue(argv, ++index, argument);
    } else if (argument === "--root") {
      rejectDuplicate(seen, argument);
      options.root = requireValue(argv, ++index, argument);
    } else if (argument === "--dry-run") {
      rejectDuplicate(seen, argument);
      options.dryRun = true;
    } else {
      throw new Error(`unknown VPS publish argument: ${argument}`);
    }
  }

  if (!options.artifact) {
    throw new Error("--artifact is required");
  }
  return options;
}

function deploymentIdFromManifest(manifest) {
  const policy = manifest.provenance.channelPolicy;
  if (policy?.channel !== "vps") {
    throw new Error("VPS publish requires a vps channel-policy snapshot");
  }

  const deploymentId = policy?.snapshot?.deploymentId;
  if (
    typeof deploymentId !== "string"
    || !/^[a-z0-9][a-z0-9._-]*$/.test(deploymentId)
  ) {
    throw new Error("VPS channel policy requires a valid deploymentId");
  }
  return deploymentId;
}

async function resolveOperationalRoot(value) {
  if (!value) {
    throw new Error(
      "VPS publish requires --root or DRYDOCK_VPS_ROOT"
    );
  }
  if (!isAbsolute(value)) {
    throw new Error("VPS operational root must be an absolute path");
  }

  const root = resolve(value);
  if (root === resolve(root, "..")) {
    throw new Error("VPS operational root must not be a filesystem root");
  }

  const rootInfo = await lstat(root);
  if (rootInfo.isSymbolicLink()) {
    throw new Error("VPS operational root must not be a symbolic link");
  }
  if (!rootInfo.isDirectory()) {
    throw new Error("VPS operational root must be a directory");
  }

  return realpath(root);
}

function rejectDuplicate(seen, flag) {
  if (seen.has(flag)) {
    throw new Error(`${flag} may be provided only once`);
  }
  seen.add(flag);
}

async function validateManifest(manifest) {
  await validateArtifactManifest(manifest, repoRoot);

  if (manifest.platform !== "web" || manifest.buildAdapter !== "web-static") {
    throw new Error("VPS channel only accepts web-static artifacts");
  }
  if (manifest.releasable !== true) {
    throw new Error("VPS publish rejects an artifact that is not releasable");
  }
}

function requireValue(argv, index, flag) {
  const value = argv[index];

  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }

  return value;
}
