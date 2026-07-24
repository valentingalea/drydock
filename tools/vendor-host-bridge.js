#!/usr/bin/env node
import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(repoRoot, "packages/host-bridge/src/index.js");
const target = resolve(repoRoot, "game/vendor/drydock-host-bridge/index.js");

await mkdir(dirname(target), { recursive: true });
await copyFile(source, target);
console.log(`vendored host bridge: ${target}`);
