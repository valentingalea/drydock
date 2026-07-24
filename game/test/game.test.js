import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { assertHostConformance } from "../../contracts/host-bridge/src/index.js";
import { connectHost } from "../host-bridge.js";

const repoRoot = resolve(import.meta.dirname, "../..");

test("index.html references only local runtime assets", async () => {
  const html = await readFile(resolve(repoRoot, "game/index.html"), "utf8");
  const main = await readFile(resolve(repoRoot, "game/src/main.js"), "utf8");

  assert.equal(/https?:\/\//.test(html), false);
  assert.equal(/src=["']\/\//.test(html), false);
  assert.match(html, /src="\.\/src\/main\.js"/);
  assert.match(main, /from "\.\.\/vendor\/three\/three\.module\.min\.js"/);
  assert.doesNotMatch(main, /node_modules|https?:\/\//);
});

test("vendored host bridge mirrors the shared package source", async () => {
  const source = await readFile(resolve(repoRoot, "contracts/host-bridge/src/index.js"), "utf8");
  const vendored = await readFile(
    resolve(repoRoot, "game/vendor/drydock-host-bridge/index.js"),
    "utf8"
  );

  assert.equal(vendored, source);
});

test("vendored Three.js mirrors the installed runtime package", async () => {
  const packageJson = JSON.parse(
    await readFile(resolve(repoRoot, "game/node_modules/three/package.json"), "utf8")
  );
  const vendoredPackageJson = JSON.parse(
    await readFile(resolve(repoRoot, "game/vendor/three/package.json"), "utf8")
  );
  const source = await readFile(resolve(repoRoot, "game/node_modules/three/build/three.module.min.js"), "utf8");
  const vendored = await readFile(resolve(repoRoot, "game/vendor/three/three.module.min.js"), "utf8");
  const sourceCore = await readFile(resolve(repoRoot, "game/node_modules/three/build/three.core.min.js"), "utf8");
  const vendoredCore = await readFile(resolve(repoRoot, "game/vendor/three/three.core.min.js"), "utf8");
  const sourceLicense = await readFile(resolve(repoRoot, "game/node_modules/three/LICENSE"), "utf8");
  const vendoredLicense = await readFile(resolve(repoRoot, "game/vendor/three/LICENSE"), "utf8");

  assert.equal(vendored, source);
  assert.equal(vendoredCore, sourceCore);
  assert.equal(vendoredLicense, sourceLicense);
  assert.deepEqual(vendoredPackageJson, {
    name: "three",
    version: packageJson.version,
    module: "three.module.min.js",
    license: packageJson.license
  });
});

test("web host bridge shim creates a conformant development host", async () => {
  await assert.doesNotReject(assertHostConformance(await connectHost()));
});
