import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  stat,
  writeFile
} from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildStaticWeb } from "../../../build/static/build.js";
import { resolveProjectContext } from "../../../../../tools/drydock.js";
import {
  createMinimalProject,
  harnessRoot,
  loadMinimalVerifiedProject
} from "../../../../../test/support/minimal-project.js";
import { parseArgs, publishVps } from "../publish.js";
import {
  parseArgs as parseVerifyArgs,
  resolveRouteUrl,
  verifyVps
} from "../verify.js";

test("parses VPS publish arguments", () => {
  assert.deepEqual(parseArgs(["artifact.json", "--root", "/tmp/drydock", "--dry-run"]), {
    _: ["artifact.json"],
    root: "/tmp/drydock",
    dryRun: true
  });
  assert.throws(() => parseArgs(["--root"]), /--root requires/);
});

test("VPS publish copies a packaged web artifact to the deploy root", async (context) => {
  const fixture = await createMinimalProject(
    context,
    undefined,
    async ({ shippingRoot }) => {
      await mkdir(join(shippingRoot, "releases"));
      await writeFile(
        join(shippingRoot, "releases", "0.1.0.yaml"),
        "version: 0.1.0\nbuild:\n  vps: 8\n"
      );
    }
  );
  const projectContext = await resolveProjectContext(fixture.projectPath, {
    invocationCwd: fixture.projectRoot,
    selectedHarnessRoot: harnessRoot
  });
  const verified = await loadMinimalVerifiedProject(fixture);
  const out = join(fixture.projectRoot, "artifacts", "build", "web-static");
  const root = await mkdtemp(join(tmpdir(), "drydock-vps-root-"));

  await buildStaticWeb({
    context: projectContext,
    options: {
      profile: "development",
      release: "shipping/releases/0.1.0.yaml"
    },
    verified
  });

  await writeFile(join(root, "stale.txt"), "old\n");
  await publishVps({
    _: [join(out, "drydock-artifact.json")],
    root
  });

  await stat(join(root, "index.html"));
  await stat(join(root, "game/src/platform-host.js"));
  await stat(join(root, "game/src/value.js"));
  await stat(join(root, "host-bridge.js"));
  await stat(join(root, "drydock-artifact.json"));
  await stat(join(root, ".drydock-channel"));
  await assert.rejects(stat(join(root, "stale.txt")), { code: "ENOENT" });
});

test("VPS Caddy templates keep allowlisted file serving explicit", async () => {
  const wholeDomain = await readFile(join(import.meta.dirname, "../caddy.example"), "utf8");
  const pathMounted = await readFile(join(import.meta.dirname, "../caddy.path.example"), "utf8");

  assert.match(wholeDomain, /DRYDOCK_WEB_ROOT/);
  assert.match(wholeDomain, /\/srv\/drydock\/web/);
  assert.match(wholeDomain, /\/product\/\*/);
  assert.doesNotMatch(wholeDomain, /try_files \{path\} \/index\.html/);
  assert.match(pathMounted, /handle_path \/drydock-release\/\*/);
  assert.match(pathMounted, /\/product\/\*/);
  assert.doesNotMatch(pathMounted, /try_files \{path\} \/index\.html/);
});

test("parses VPS verify arguments and env defaults", () => {
  assert.deepEqual(parseVerifyArgs([], {
    DRYDOCK_LIVE_URL: "https://example.com/drydock/",
    DRYDOCK_RELEASE_URL: "https://example.com/drydock-release/"
  }), {
    liveUrl: "https://example.com/drydock/",
    releaseUrl: "https://example.com/drydock-release/"
  });

  assert.deepEqual(parseVerifyArgs([
    "--live-url",
    "https://example.com/live/",
    "--release-url",
    "https://example.com/release/",
    "--timeout-ms",
    "1000"
  ]), {
    liveUrl: "https://example.com/live/",
    releaseUrl: "https://example.com/release/",
    timeoutMs: 1000
  });

  assert.throws(() => parseVerifyArgs(["--live-url"]), /--live-url requires/);
  assert.throws(() => parseVerifyArgs(["--timeout-ms", "1"]), /--timeout-ms/);
});

test("VPS verifier preserves path-mounted route prefixes", () => {
  assert.equal(
    resolveRouteUrl("https://example.com/drydock", "/product/mock-game/index.html"),
    "https://example.com/drydock/product/mock-game/index.html"
  );
  assert.equal(
    resolveRouteUrl("https://example.com/drydock-release/", "/"),
    "https://example.com/drydock-release/"
  );
});

test("VPS verifier checks public allow and deny paths for both route mounts", async () => {
  const server = createHttpServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const denied = pathname.endsWith("/package.json")
      || pathname.endsWith("/.git/config")
      || pathname.endsWith("/product/.git")
      || pathname.endsWith("/product/AGENTS.md")
      || pathname.endsWith("/product/package.json")
      || pathname.endsWith("/product/test/unit/scope.test.js")
      || pathname.endsWith("/product/drydock-product.json")
      || pathname.endsWith("/drydock-artifact.json")
      || pathname.endsWith("/.drydock-channel");

    response.writeHead(denied ? 404 : 200, {
      "Content-Type": "text/plain; charset=utf-8"
    });
    response.end(denied ? "not found" : "ok");
  });

  await new Promise((resolveListen) => {
    server.listen(0, "127.0.0.1", resolveListen);
  });

  try {
    const { port } = server.address();
    const root = `http://127.0.0.1:${port}`;
    const results = await verifyVps({
      liveUrl: `${root}/drydock/`,
      releaseUrl: `${root}/drydock-release/`,
      timeoutMs: 1000
    });

    assert.equal(results.length, 58);
    assert.equal(results.filter((result) => result.status === 404).length, 18);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
});
