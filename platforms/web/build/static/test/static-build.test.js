import assert from "node:assert/strict";
import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import { buildStaticWeb, parseArgs } from "../build.js";

const repoRoot = resolve(import.meta.dirname, "../../../../..");

test("parses static build arguments", () => {
  assert.deepEqual(parseArgs(["--release", "r.yaml", "--out", "artifacts/tmp/test", "--channel", "vps"]), {
    release: "r.yaml",
    out: "artifacts/tmp/test",
    channel: "vps"
  });
  assert.throws(() => parseArgs(["--out"]), /--out requires/);
});

test("static build copies runtime files and emits schema-valid artifact", async () => {
  const out = await mkdtemp(join(tmpdir(), "drydock-web-static-"));
  const { manifest } = await buildStaticWeb({
    release: "contracts/releases/0.1.0.yaml",
    out
  });

  await stat(join(out, "index.html"));
  await stat(join(out, "host-bridge.js"));
  await stat(join(out, "vendor/drydock-host-bridge/index.js"));
  await stat(join(out, "engine/mock-game/index.html"));
  await stat(join(out, "engine/mock-game/src/bootstrap.js"));
  await stat(join(out, "engine/mock-game/src/boot-guard.js"));
  await stat(join(out, "engine/mock-game/src/game.js"));
  await stat(join(out, "engine/mock-game/src/platform-host.js"));
  await stat(join(out, "engine/mock-game/style/mock.css"));
  await stat(join(out, "engine/src/core/scope.js"));
  await stat(join(out, "engine/style/hud.css"));
  await stat(join(out, "engine/lib/three.module.js"));

  await assert.rejects(stat(join(out, "package.json")), { code: "ENOENT" });
  await assert.rejects(stat(join(out, "test/game.test.js")), { code: "ENOENT" });
  await assert.rejects(stat(join(out, "engine/AGENTS.md")), { code: "ENOENT" });
  await assert.rejects(stat(join(out, "engine/package.json")), { code: "ENOENT" });

  const schema = JSON.parse(
    await readFile(resolve(repoRoot, "contracts/schemas/drydock-artifact.schema.json"), "utf8")
  );
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);

  assert.equal(validate(manifest), true, JSON.stringify(validate.errors, null, 2));
  assert.equal(manifest.platform, "web");
  assert.equal(manifest.engine, "web-static");
  assert.equal(manifest.gameId, "line-engine-calibration");
  assert.equal(manifest.buildNumber, 100);
  assert.equal(manifest.extensions.drydock.entrypoint, "engine/mock-game/index.html");
  assert.match(manifest.extensions.drydock.engineRevision.commit, /^[a-f0-9]{40}$/);
  assert.equal(manifest.extensions.drydock.channelConfig.root, "/var/www/drydock");
});
