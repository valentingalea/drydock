#!/usr/bin/env node
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

await vendorHostBridge();

async function vendorHostBridge() {
  const source = resolve(repoRoot, "contracts/host-bridge/src/index.js");
  const target = resolve(repoRoot, "runtime/web/vendor/drydock-host-bridge/index.js");

  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
  console.log(`vendored host bridge: ${relativeToRepo(target)}`);
}

function relativeToRepo(path) {
  return path.slice(repoRoot.length + 1);
}
