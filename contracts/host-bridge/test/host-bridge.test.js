import assert from "node:assert/strict";
import test from "node:test";
import {
  DEV_HOST_CAPABILITIES,
  HOST_PROTOCOL_VERSION,
  HostErrorCode,
  assertHostConformance,
  createDevHost,
  createMemoryStorageAdapter,
  isHostResult,
  normalizeCapabilities,
  ok,
  unsupported
} from "../src/index.js";

test("normalizes host capabilities with conservative defaults", () => {
  assert.deepEqual(normalizeCapabilities(), {
    storage: "none",
    achievements: false,
    telemetry: false,
    purchases: false,
    identity: false
  });

  assert.deepEqual(normalizeCapabilities({ storage: "cloud", achievements: true }), {
    storage: "cloud",
    achievements: true,
    telemetry: false,
    purchases: false,
    identity: false
  });
});

test("rejects unknown storage capabilities", () => {
  assert.throws(
    () => normalizeCapabilities({ storage: "disk" }),
    /unsupported storage capability/
  );
});

test("creates stable HostResult values", () => {
  assert.equal(isHostResult(ok("value")), true);

  const result = unsupported("achievements");
  assert.equal(isHostResult(result), true);
  assert.equal(result.ok, false);
  assert.equal(result.code, HostErrorCode.Unsupported);
});

test("memory storage saves cloned values", async () => {
  const storage = createMemoryStorageAdapter();
  const value = { nested: { count: 1 } };

  assert.deepEqual(await storage.save("slot1", value), ok(null));

  value.nested.count = 2;
  const loaded = await storage.load("slot1");

  assert.equal(loaded.ok, true);
  assert.deepEqual(loaded.value, { nested: { count: 1 } });
});

test("dev host reports local storage and unsupported optional services", async () => {
  const host = createDevHost();

  assert.equal(host.protocolVersion, HOST_PROTOCOL_VERSION);
  assert.deepEqual(DEV_HOST_CAPABILITIES, {
    storage: "local",
    achievements: false,
    telemetry: false,
    purchases: false,
    identity: false
  });
  assert.deepEqual(await host.capabilities(), DEV_HOST_CAPABILITIES);

  const achievement = await host.achievements.unlock("first_win");
  assert.equal(achievement.ok, false);
  assert.equal(achievement.code, HostErrorCode.Unsupported);
});

test("dev host can be configured with no storage", async () => {
  const host = createDevHost({ capabilities: { storage: "none" } });

  assert.deepEqual(await host.capabilities(), {
    storage: "none",
    achievements: false,
    telemetry: false,
    purchases: false,
    identity: false
  });

  const save = await host.storage.save("slot1", {});
  assert.equal(save.ok, false);
  assert.equal(save.code, HostErrorCode.Unsupported);
});

test("dev host passes the shared conformance checks", async () => {
  await assert.doesNotReject(assertHostConformance(createDevHost()));
});
