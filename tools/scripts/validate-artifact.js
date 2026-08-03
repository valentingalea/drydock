#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  validateArtifactManifest,
  verifyArtifactChecksums
} from "../artifacts.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function usage() {
  console.error(
    "usage: node tools/scripts/validate-artifact.js [--checksums] <drydock-artifact.json>"
  );
}

async function readJson(path) {
  const text = await readFile(path, "utf8");
  return JSON.parse(text);
}

const args = process.argv.slice(2).filter((arg) => arg !== "--");
const verifyChecksums = args.includes("--checksums");
const positional = args.filter((arg) => arg !== "--checksums");
const [manifestPath] = positional;

if (!manifestPath || positional.length !== 1) {
  usage();
  process.exit(2);
}

const dataPath = resolve(process.cwd(), manifestPath);

try {
  const manifest = await readJson(dataPath);
  await validateArtifactManifest(manifest, repoRoot);
  if (verifyChecksums) {
    await verifyArtifactChecksums(manifest, dataPath);
  }

  console.log(
    `${verifyChecksums ? "verified artifact" : "valid artifact manifest"}: ${manifestPath}`
  );
} catch (error) {
  console.error(`artifact validation failed: ${error.message}`);
  process.exit(1);
}
