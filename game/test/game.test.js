import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { assertHostConformance } from "../../packages/host-bridge/src/index.js";
import { connectHost } from "../host-bridge.js";

const repoRoot = resolve(import.meta.dirname, "../..");

test("index.html references only local runtime assets", async () => {
  const html = await readFile(resolve(repoRoot, "game/index.html"), "utf8");

  assert.equal(/https?:\/\//.test(html), false);
  assert.equal(/src=["']\/\//.test(html), false);
  assert.match(html, /src="\.\/src\/main\.js"/);
});

test("vendored host bridge mirrors the shared package source", async () => {
  const source = await readFile(resolve(repoRoot, "packages/host-bridge/src/index.js"), "utf8");
  const vendored = await readFile(
    resolve(repoRoot, "game/vendor/drydock-host-bridge/index.js"),
    "utf8"
  );

  assert.equal(vendored, source);
});

test("web host bridge shim creates a conformant development host", async () => {
  await assert.doesNotReject(assertHostConformance(await connectHost()));
});
