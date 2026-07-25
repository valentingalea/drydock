import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import { assertHostConformance } from "../../contracts/host-bridge/src/index.js";
import { connectHost } from "../host-bridge.js";
import {
  loadPayload,
  resolvePayloadRequest
} from "../../tools/scripts/payload.js";

const repoRoot = resolve(import.meta.dirname, "../..");

test("payload descriptor selects the sole Line Engine mock", async () => {
  const payload = await loadPayload(repoRoot);

  assert.equal(payload.gameId, "line-engine-calibration");
  assert.equal(payload.entrypoint, "engine/mock-game/index.html");
  assert.equal(payload.engine.name, "line-engine");
  assert.equal(payload.engine.release, "v0.0.0");
  assert.equal(payload.engine.threeRevision, "r160");
  await stat(resolve(repoRoot, payload.entrypoint));
});

test("payload composition overlays the Line Engine host extension point", async () => {
  const payload = await loadPayload(repoRoot);
  const platformHost = resolvePayloadRequest(
    payload,
    "/engine/mock-game/src/platform-host.js"
  );
  const source = await readFile(platformHost, "utf8");

  assert.equal(platformHost, resolve(repoRoot, "game/overlays/platform-host.js"));
  assert.match(source, /connectHost/);
  assert.match(source, /\.\.\/\.\.\/\.\.\/host-bridge\.js/);
});

test("payload composition exposes runtime files and denies submodule internals", async () => {
  const payload = await loadPayload(repoRoot);

  assert.ok(resolvePayloadRequest(payload, "/engine/mock-game/index.html"));
  assert.ok(resolvePayloadRequest(payload, "/engine/src/core/scope.js"));
  assert.ok(resolvePayloadRequest(payload, "/engine/lib/three.module.js"));
  assert.equal(resolvePayloadRequest(payload, "/engine/AGENTS.md"), null);
  assert.equal(resolvePayloadRequest(payload, "/engine/package.json"), null);
  assert.equal(resolvePayloadRequest(payload, "/engine/test/unit/scope.test.js"), null);
  assert.equal(resolvePayloadRequest(payload, "/../AGENTS.md"), null);
});

test("vendored host bridge mirrors the shared package source", async () => {
  const source = await readFile(resolve(repoRoot, "contracts/host-bridge/src/index.js"), "utf8");
  const vendored = await readFile(
    resolve(repoRoot, "game/vendor/drydock-host-bridge/index.js"),
    "utf8"
  );

  assert.equal(vendored, source);
});

test("web host bridge shim creates a conformant development host", async () => {
  await assert.doesNotReject(assertHostConformance(await connectHost()));
});
