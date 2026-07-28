import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildStaticWeb } from "../../../build/static/build.js";
import {
  resolveProjectContext,
  runCli
} from "../../../../../tools/drydock.js";
import {
  createMinimalProject,
  harnessRoot,
  loadMinimalVerifiedProject
} from "../../../../../test/support/minimal-project.js";
import { parseArgs, publishVps } from "../publish.js";
import {
  liveRuntimePathsFromManifest,
  parseArgs as parseVerifyArgs,
  resolveArtifactPath,
  resolveRouteUrl,
  runtimePathsFromManifest,
  verifyVps
} from "../verify.js";

test("parses VPS publish arguments", () => {
  assert.deepEqual(parseArgs([
    "--artifact",
    "artifacts/build/web/drydock-artifact.json",
    "--root",
    "/srv/games",
    "--dry-run"
  ]), {
    artifact: "artifacts/build/web/drydock-artifact.json",
    root: "/srv/games",
    dryRun: true
  });
  assert.throws(() => parseArgs([]), /--artifact is required/);
  assert.throws(() => parseArgs(["--root"]), /--root requires/);
});

test("VPS publish copies a packaged web artifact to the deploy root", async (context) => {
  const fixture = await createMinimalProject(
    context,
    undefined,
    async ({ shippingRoot }) => {
      await mkdir(join(shippingRoot, "releases"));
      await mkdir(join(shippingRoot, "channels"));
      await writeFile(
        join(shippingRoot, "releases", "0.1.0.yaml"),
        "version: 0.1.0\nbuild:\n  vps: 8\n"
      );
      await writeFile(
        join(shippingRoot, "channels", "vps.yaml"),
        "deploymentId: fixture-game\nroute: fixture-vps\n"
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

  const manifestPath = join(out, "drydock-artifact.json");
  await assert.rejects(
    publishVps({
      context: projectContext,
      options: {
        artifact: "artifacts/build/web-static/drydock-artifact.json",
        root
      }
    }),
    /artifact that is not releasable/
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.releasable = true;
  manifest.provenance.adapter.profile = "release";
  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`
  );

  const cliOutput = captureStream();
  const cliErrors = captureStream();
  assert.equal(
    await runCli([
      "publish",
      "vps",
      "--project",
      fixture.projectPath,
      "--artifact",
      "artifacts/build/web-static/drydock-artifact.json",
      "--root",
      root,
      "--dry-run"
    ], {
      invocationCwd: harnessRoot,
      stderr: cliErrors,
      stdout: cliOutput
    }),
    0,
    cliErrors.value
  );
  assert.equal(cliErrors.value, "");
  assert.match(cliOutput.value, /would deploy .*fixture-game/);

  const linkedRoot = join(fixture.projectRoot, "linked-vps-root");
  await symlink(root, linkedRoot, "dir");
  await assert.rejects(
    publishVps({
      context: projectContext,
      options: {
        artifact: "artifacts/build/web-static/drydock-artifact.json",
        root: linkedRoot,
        dryRun: true
      }
    }),
    /must not be a symbolic link/
  );

  await writeFile(join(root, "stale.txt"), "old\n");
  const result = await publishVps({
    context: projectContext,
    options: {
      artifact: "artifacts/build/web-static/drydock-artifact.json",
      root
    }
  });
  const deployedRoot = join(root, "fixture-game");

  assert.equal(result.root, deployedRoot);
  await stat(join(deployedRoot, "index.html"));
  await stat(join(deployedRoot, "game/src/platform-host.js"));
  await stat(join(deployedRoot, "game/src/value.js"));
  await stat(join(deployedRoot, "host-bridge.js"));
  await stat(join(deployedRoot, "drydock-artifact.json"));
  await stat(join(deployedRoot, ".drydock-channel"));
  await stat(join(root, "stale.txt"));
});

function captureStream() {
  return {
    value: "",
    write(chunk) {
      this.value += chunk;
    }
  };
}

test("VPS Caddy templates keep allowlisted file serving explicit", async () => {
  const wholeDomain = await readFile(join(import.meta.dirname, "../caddy.example"), "utf8");
  const pathMounted = await readFile(join(import.meta.dirname, "../caddy.path.example"), "utf8");

  assert.match(wholeDomain, /DRYDOCK_WEB_ROOT/);
  assert.match(wholeDomain, /DRYDOCK_HOSTNAME/);
  assert.doesNotMatch(wholeDomain, /\/srv\//);
  assert.match(wholeDomain, /\/package\.json/);
  assert.match(wholeDomain, /\/\.git\/\*/);
  assert.match(wholeDomain, /\/shipping\/\*/);
  assert.match(wholeDomain, /\/drydock-artifact\.json/);
  assert.doesNotMatch(wholeDomain, /\/product\/\*/);
  assert.doesNotMatch(wholeDomain, /try_files \{path\} \/index\.html/);
  assert.match(pathMounted, /handle_path \/\{\$DRYDOCK_ROUTE\}\/\*/);
  assert.match(pathMounted, /DRYDOCK_WEB_ROOT/);
  assert.match(pathMounted, /DRYDOCK_HOSTNAME/);
  assert.doesNotMatch(pathMounted, /\/srv\//);
  assert.match(pathMounted, /\/package\.json/);
  assert.match(pathMounted, /\/\.git\/\*/);
  assert.match(pathMounted, /\/shipping\/\*/);
  assert.doesNotMatch(pathMounted, /\/product\/\*/);
  assert.doesNotMatch(pathMounted, /try_files \{path\} \/index\.html/);
});

test("parses VPS verify arguments and env defaults", () => {
  assert.deepEqual(parseVerifyArgs([], {
    DRYDOCK_LIVE_URL: "https://example.com/live/",
    DRYDOCK_RELEASE_URL: "https://example.com/releases/"
  }), {
    liveUrl: "https://example.com/live/",
    releaseUrl: "https://example.com/releases/"
  });

  assert.deepEqual(parseVerifyArgs([
    "--artifact",
    "artifacts/build/web/drydock-artifact.json",
    "--live-url",
    "https://example.com/live/",
    "--release-url",
    "https://example.com/release/",
    "--timeout-ms",
    "1000"
  ]), {
    artifact: "artifacts/build/web/drydock-artifact.json",
    liveUrl: "https://example.com/live/",
    releaseUrl: "https://example.com/release/",
    timeoutMs: 1000
  });

  assert.throws(() => parseVerifyArgs(["--live-url"]), /--live-url requires/);
  assert.throws(() => parseVerifyArgs(["--timeout-ms", "1"]), /--timeout-ms/);
});

test("VPS verifier preserves path-mounted route prefixes", () => {
  assert.equal(
    resolveRouteUrl("https://example.com/live", "/game/src/main.js"),
    "https://example.com/live/game/src/main.js"
  );
  assert.equal(
    resolveRouteUrl("https://example.com/releases/", "/"),
    "https://example.com/releases/"
  );
  assert.equal(
    resolveRouteUrl(
      "https://example.com/releases/",
      "/game/help#topic?.html"
    ),
    "https://example.com/releases/game/help%23topic%3F.html"
  );
});

test("VPS verifier resolves artifacts from the lifecycle invocation directory", () => {
  const projectRoot = join(tmpdir(), "example-game");
  const packageRoot = join(projectRoot, "drydock", "platforms", "web");

  assert.equal(
    resolveArtifactPath(
      "artifacts/build/web-static/drydock-artifact.json",
      {
        INIT_CWD: projectRoot
      },
      packageRoot
    ),
    join(
      projectRoot,
      "artifacts",
      "build",
      "web-static",
      "drydock-artifact.json"
    )
  );
});

test("VPS verifier uses metadata-only requests and cancels response bodies", async () => {
  const methods = [];
  let canceled = 0;

  await verifyVps({
    fetchImpl: async (url, options) => {
      methods.push(options.method);
      return {
        body: {
          async cancel() {
            canceled += 1;
          }
        },
        status: new URL(url).pathname.endsWith("asset.bin") ? 200 : 404
      };
    },
    liveUrl: "https://example.com/live/",
    runtimePaths: ["/asset.bin"]
  });

  assert.deepEqual(new Set(methods), new Set(["HEAD"]));
  assert.equal(canceled, methods.length);
});

test("VPS verifier excludes the release-only redirect from custom-entrypoint live checks", async () => {
  const manifest = {
    checksums: [
      {
        path: "index.html"
      },
      {
        path: "game/start.html"
      }
    ],
    extensions: {
      drydock: {
        entrypoint: "game/start.html"
      }
    }
  };
  const liveRuntimePaths = liveRuntimePathsFromManifest(manifest);
  const releaseRuntimePaths = runtimePathsFromManifest(manifest);
  const requests = [];

  await verifyVps({
    fetchImpl: async (url) => {
      const parsed = new URL(url);
      const route = parsed.pathname.startsWith("/live/")
        ? "live"
        : "release";
      const path = parsed.pathname.replace(/^\/(?:live|releases)/u, "") || "/";
      requests.push({ path, route });
      const denied = [
        "/package.json",
        "/.git/config",
        "/shipping/drydock-project.json",
        "/drydock-artifact.json",
        "/.drydock-channel"
      ].includes(path);
      return new Response(null, {
        status: denied ? 404 : 200
      });
    },
    liveUrl: "https://example.com/live/",
    manifest,
    releaseUrl: "https://example.com/releases/"
  });

  assert.equal(liveRuntimePaths.includes("/index.html"), false);
  assert.equal(releaseRuntimePaths.includes("/index.html"), true);
  assert.equal(
    requests.some(({ path, route }) => route === "live" && path === "/index.html"),
    false
  );
  assert.equal(
    requests.some(({ path, route }) => route === "release" && path === "/index.html"),
    true
  );
});

test("VPS verifier checks public allow and deny paths for both route mounts", async () => {
  const manifest = {
    checksums: [
      {
        path: "index.html"
      },
      {
        path: "game/src/main.js"
      },
      {
        path: "vendor/bridge/index.html"
      }
    ]
  };
  const runtimePaths = runtimePathsFromManifest(manifest);
  const deniedPaths = new Set([
    "/package.json",
    "/.git/config",
    "/shipping/drydock-project.json",
    "/drydock-artifact.json",
    "/.drydock-channel"
  ]);
  const server = createHttpServer((request, response) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const routePath = pathname.replace(
      /^\/(?:releases|live)/,
      ""
    ) || "/";
    const denied = deniedPaths.has(routePath);
    const allowed = runtimePaths.includes(routePath);

    response.writeHead(denied ? 404 : allowed ? 200 : 500, {
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
      liveUrl: `${root}/live/`,
      releaseUrl: `${root}/releases/`,
      manifest,
      timeoutMs: 1000
    });

    assert.equal(
      results.length,
      2 * (runtimePaths.length + deniedPaths.size)
    );
    assert.equal(
      results.filter((result) => result.status === 404).length,
      2 * deniedPaths.size
    );
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
});
