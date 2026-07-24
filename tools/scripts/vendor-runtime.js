#!/usr/bin/env node
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

await vendorHostBridge();
await vendorThree();

async function vendorHostBridge() {
  const source = resolve(repoRoot, "contracts/host-bridge/src/index.js");
  const target = resolve(repoRoot, "game/vendor/drydock-host-bridge/index.js");

  await mkdir(dirname(target), { recursive: true });
  await copyFile(source, target);
  console.log(`vendored host bridge: ${relativeToRepo(target)}`);
}

async function vendorThree() {
  const packageRoot = resolve(repoRoot, "game/node_modules/three");
  const packageJson = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
  const targetRoot = resolve(repoRoot, "game/vendor/three");

  await mkdir(targetRoot, { recursive: true });
  await copyFile(
    resolve(packageRoot, "build/three.module.min.js"),
    resolve(targetRoot, "three.module.min.js")
  );
  await copyFile(
    resolve(packageRoot, "build/three.core.min.js"),
    resolve(targetRoot, "three.core.min.js")
  );
  await copyFile(resolve(packageRoot, "LICENSE"), resolve(targetRoot, "LICENSE"));
  await writeFile(
    resolve(targetRoot, "package.json"),
    `${JSON.stringify({
      name: packageJson.name,
      version: packageJson.version,
      module: "three.module.min.js",
      license: packageJson.license
    }, null, 2)}\n`
  );

  console.log(`vendored three: ${relativeToRepo(targetRoot)}`);
}

function relativeToRepo(path) {
  return path.slice(repoRoot.length + 1);
}
