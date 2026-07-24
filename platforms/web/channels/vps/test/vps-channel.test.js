import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildStaticWeb } from "../../../build/static/build.js";
import { parseArgs, publishVps } from "../publish.js";

test("parses VPS publish arguments", () => {
  assert.deepEqual(parseArgs(["artifact.json", "--root", "/tmp/drydock", "--dry-run"]), {
    _: ["artifact.json"],
    root: "/tmp/drydock",
    dryRun: true
  });
  assert.throws(() => parseArgs(["--root"]), /--root requires/);
});

test("VPS publish copies a packaged web artifact to the deploy root", async () => {
  const out = await mkdtemp(join(tmpdir(), "drydock-vps-artifact-"));
  const root = await mkdtemp(join(tmpdir(), "drydock-vps-root-"));

  await buildStaticWeb({
    release: "releases/1.4.0.yaml",
    out
  });

  await writeFile(join(root, "stale.txt"), "old\n");
  await publishVps({
    _: [join(out, "drydock-artifact.json")],
    root
  });

  await stat(join(root, "index.html"));
  await stat(join(root, "src/main.js"));
  await stat(join(root, "drydock-artifact.json"));
  await stat(join(root, ".drydock-channel"));
  await assert.rejects(stat(join(root, "stale.txt")), { code: "ENOENT" });
});

test("VPS Caddy templates keep allowlisted file serving explicit", async () => {
  const wholeDomain = await readFile(join(import.meta.dirname, "../caddy.example"), "utf8");
  const pathMounted = await readFile(join(import.meta.dirname, "../caddy.path.example"), "utf8");

  assert.match(wholeDomain, /root \* \/var\/www\/drydock/);
  assert.match(wholeDomain, /@allowed path \/ \/index\.html \/host-bridge\.js \/src\/\* \/assets\/\* \/vendor\/\*/);
  assert.match(pathMounted, /handle_path \/drydock-release\/\*/);
  assert.match(pathMounted, /@drydock_release_allowed path \/ \/index\.html \/host-bridge\.js \/src\/\* \/assets\/\* \/vendor\/\*/);
});
