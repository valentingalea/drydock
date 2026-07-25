import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { assertHostConformance } from "../../host-bridge/src/index.js";
import { connectHost } from "../../../runtime/web/host-bridge.js";
import {
  loadProduct,
  resolveProductRequest
} from "../../../tools/scripts/product.js";

const repoRoot = resolve(import.meta.dirname, "../../..");

test("product contract selects the proof product without exposing its engine", async () => {
  const product = await loadProduct(repoRoot);

  assert.equal(product.productId, "line-engine-calibration");
  assert.equal(product.entrypoint, "product/mock-game/index.html");
  assert.equal("engine" in product, false);
  await stat(resolve(repoRoot, "product/drydock-product.json"));
});

test("product owns its Drydock host adapter", async () => {
  const product = await loadProduct(repoRoot);
  const platformHost = resolveProductRequest(
    product,
    "/product/mock-game/src/platform-host.js"
  );
  const source = await readFile(platformHost, "utf8");

  assert.equal(
    platformHost,
    resolve(repoRoot, "product/integrations/drydock/platform-host.js")
  );
  assert.match(source, /connectHost/);
  assert.match(source, /\.\.\/\.\.\/\.\.\/host-bridge\.js/);
});

test("composition exposes selected product files and denies repository internals", async () => {
  const product = await loadProduct(repoRoot);

  assert.ok(resolveProductRequest(product, "/product/mock-game/index.html"));
  assert.ok(resolveProductRequest(product, "/product/src/core/scope.js"));
  assert.ok(resolveProductRequest(product, "/product/lib/three.module.js"));
  assert.equal(resolveProductRequest(product, "/product/AGENTS.md"), null);
  assert.equal(resolveProductRequest(product, "/product/package.json"), null);
  assert.equal(resolveProductRequest(product, "/product/test/unit/scope.test.js"), null);
  assert.equal(resolveProductRequest(product, "/../AGENTS.md"), null);
});

test("vendored host bridge mirrors the shared package source", async () => {
  const source = await readFile(resolve(repoRoot, "contracts/host-bridge/src/index.js"), "utf8");
  const vendored = await readFile(
    resolve(repoRoot, "runtime/web/vendor/drydock-host-bridge/index.js"),
    "utf8"
  );

  assert.equal(vendored, source);
});

test("web host bridge shim creates a conformant development host", async () => {
  await assert.doesNotReject(assertHostConformance(await connectHost()));
});
