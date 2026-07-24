#!/usr/bin/env node
import { cp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");

if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs(process.argv.slice(2));
  await publishVps(options);
}

export async function publishVps(options = {}) {
  if (!options.manifest && !options._[0]) {
    throw new Error("usage: node publish.js <drydock-artifact.json> [--root path] [--dry-run]");
  }

  const manifestPath = await resolveExistingPath(options.manifest ?? options._[0]);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  await validateManifest(manifest);

  const artifactRoot = resolve(dirname(manifestPath), manifest.artifactRoot);
  const root = resolve(
    options.root
      ?? manifest.extensions?.drydock?.channelConfig?.root
      ?? "/var/www/drydock"
  );

  await assertDirectory(artifactRoot);

  if (options.dryRun) {
    console.log(`would deploy ${artifactRoot} -> ${root}`);
    return { artifactRoot, root, dryRun: true };
  }

  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  await cp(artifactRoot, root, { recursive: true, dereference: true });
  await writeFile(resolve(root, ".drydock-channel"), "vps\n");

  console.log(`deployed static web artifact: ${artifactRoot} -> ${root}`);
  return { artifactRoot, root, dryRun: false };
}

async function resolveExistingPath(path) {
  const candidates = isAbsolute(path)
    ? [path]
    : [
        resolve(process.cwd(), path),
        resolve(repoRoot, path)
      ];

  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return candidate;
    }
  }

  return candidates.at(-1);
}

export function parseArgs(argv) {
  const options = { _: [] };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--") {
      continue;
    } else if (arg === "--manifest") {
      options.manifest = requireValue(argv, ++i, arg);
    } else if (arg === "--root") {
      options.root = requireValue(argv, ++i, arg);
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown argument: ${arg}`);
    } else {
      options._.push(arg);
    }
  }

  return options;
}

async function validateManifest(manifest) {
  const schema = JSON.parse(
    await readFile(resolve(repoRoot, "schemas/drydock-artifact.schema.json"), "utf8")
  );
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);

  if (!validate(manifest)) {
    throw new Error(`invalid artifact manifest: ${JSON.stringify(validate.errors, null, 2)}`);
  }

  if (manifest.platform !== "web" || manifest.engine !== "web-static") {
    throw new Error("VPS channel only accepts web-static artifacts");
  }
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

function requireValue(argv, index, flag) {
  const value = argv[index];

  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }

  return value;
}
