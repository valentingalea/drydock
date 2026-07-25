#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import {
  loadProduct,
  readProductRevision,
  stageProduct,
  verifyPinnedProduct
} from "../../../../tools/scripts/product.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const defaultRelease = "contracts/releases/0.1.0.yaml";
const defaultOut = "artifacts/build/web-static";
if (import.meta.url === `file://${process.argv[1]}`) {
  const options = parseArgs(process.argv.slice(2));
  await verifyPinnedProduct(repoRoot);
  await buildStaticWeb(options);
}

export async function buildStaticWeb(options = {}) {
  const releasePath = resolve(repoRoot, options.release ?? defaultRelease);
  const outDir = resolve(repoRoot, options.out ?? defaultOut);
  const channel = options.channel ?? "vps";
  const release = YAML.parse(await readFile(releasePath, "utf8"));
  const buildNumber = release?.build?.[channel];
  const product = await loadProduct(repoRoot);
  const productRevision = await readProductRevision(repoRoot, product);

  if (!Number.isInteger(buildNumber)) {
    throw new Error(`release manifest does not define build.${channel}`);
  }

  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  await stageProduct(product, outDir);

  const filePaths = await listFiles(outDir);
  const checksums = [];

  for (const filePath of filePaths) {
    const path = relative(outDir, filePath).split("\\").join("/");
    const value = createHash("sha256").update(await readFile(filePath)).digest("hex");
    checksums.push({ path, algorithm: "sha256", value });
  }

  checksums.sort((a, b) => a.path.localeCompare(b.path));

  const manifest = {
    schemaVersion: 2,
    productId: product.productId,
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
    capabilities: [
      "storage"
    ],
    checksums,
    extensions: {
      drydock: {
        adapterPackage: "@drydock/web-static",
        channel,
        entrypoint: product.entrypoint,
        productContract: product.contractPath,
        productRevision,
        release: relative(repoRoot, releasePath).split("\\").join("/"),
        channelConfig: release.channels?.[channel] ?? {}
      }
    }
  };

  await writeFile(
    resolve(outDir, "drydock-artifact.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  );

  console.log(`built static web artifact: ${relative(repoRoot, outDir)}`);
  return { outDir, manifest };
}

export function parseArgs(argv) {
  const options = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--") {
      continue;
    } else if (arg === "--release") {
      options.release = requireValue(argv, ++i, arg);
    } else if (arg === "--out") {
      options.out = requireValue(argv, ++i, arg);
    } else if (arg === "--channel") {
      options.channel = requireValue(argv, ++i, arg);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }

  return options;
}

function requireValue(argv, index, flag) {
  const value = argv[index];

  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }

  return value;
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
