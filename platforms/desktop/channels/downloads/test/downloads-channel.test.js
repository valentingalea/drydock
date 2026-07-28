import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  defaultZipName,
  packageDownloads,
  parseArgs,
  parsePackageArgs,
  resolveRouteUrl,
  verifyDownloads
} from "../package.js";
import {
  parsePublishArgs,
  publishDownloads
} from "../publish.js";
import {
  resolveProjectContext,
  runCli
} from "../../../../../tools/drydock.js";
import {
  createMinimalProject,
  harnessRoot
} from "../../../../../test/support/minimal-project.js";

const manifest = {
  schemaVersion: 3,
  releasable: true,
  productId: "fixture-game",
  version: "0.1.0",
  buildNumber: 100,
  buildAdapter: "electron",
  platform: "windows",
  arch: "x64",
  artifactRoot: "win-unpacked",
  executable: "win-unpacked/fixture-game.exe",
  bundleId: "dev.example.fixture-game",
  packageId: null,
  signing: {
    status: "unsigned"
  },
  capabilities: [
    "storage"
  ],
  checksums: [
    {
      path: "win-unpacked/fixture-game.exe",
      algorithm: "sha256",
      value: createHash("sha256").update("fake exe\n").digest("hex")
    }
  ],
  provenance: {
    project: {
      descriptor: {
        path: "shipping/drydock-project.json",
        sha256: "1".repeat(64)
      },
      commit: "1".repeat(40)
    },
    drydock: {
      commit: "2".repeat(40)
    },
    release: {
      path: "shipping/releases/0.1.0.yaml",
      sha256: "2".repeat(64)
    },
    components: {
      game: {
        path: "game",
        revision: "project",
        commit: "1".repeat(40)
      },
      shipping: {
        path: "shipping",
        revision: "project",
        commit: "1".repeat(40)
      }
    },
    adapter: {
      id: "electron",
      package: "@drydock/desktop-electron",
      profile: "release"
    },
    channelPolicy: null
  }
};

test("downloads Caddy template exposes only the current package and checksum", async () => {
  const caddy = await readFile(join(import.meta.dirname, "../caddy.path.example"), "utf8");

  assert.match(caddy, /handle_path \/\{\$DRYDOCK_DOWNLOAD_ROUTE\}\/\*/);
  assert.match(caddy, /DRYDOCK_DOWNLOAD_ROOT/);
  assert.doesNotMatch(caddy, /\/srv\//);
  assert.match(caddy, /\/\*\.zip/);
  assert.match(caddy, /\/\*\.zip\.sha256/);
  assert.match(caddy, /respond 404/);
  assert.doesNotMatch(caddy, /browse/);
  assert.doesNotMatch(caddy, /drydock-artifact\.json/);
});

test("parses downloads channel arguments", () => {
  assert.deepEqual(parsePackageArgs([
    "--artifact",
    "artifacts/build/windows-x64/drydock-artifact.json",
    "--out",
    "artifacts/packages/downloads",
    "--name",
    "fixture-game-0.1.0-windows-x64.zip"
  ]), {
    artifact: "artifacts/build/windows-x64/drydock-artifact.json",
    out: "artifacts/packages/downloads",
    name: "fixture-game-0.1.0-windows-x64.zip"
  });
  assert.throws(() => parsePackageArgs([]), /--artifact is required/);
  assert.deepEqual(parsePublishArgs([
    "--source",
    "artifacts/packages/downloads",
    "--root",
    "/srv/games",
    "--dry-run"
  ]), {
    dryRun: true,
    root: "/srv/games",
    source: "artifacts/packages/downloads"
  });
  assert.throws(() => parsePublishArgs([]), /--source is required/);

  assert.deepEqual(parseArgs([], {
    DRYDOCK_DOWNLOADS_URL: "https://example.com/drydock-downloads/"
  }), {
    _: [],
    baseUrl: "https://example.com/drydock-downloads/"
  });

  assert.throws(() => parseArgs(["--name"]), /--name requires/);
});

test("default download zip name comes from artifact identity", () => {
  assert.equal(
    defaultZipName(manifest),
    "fixture-game-0.1.0-windows-x64.zip"
  );
});

test("downloads package script creates zip, checksum, and index from an artifact manifest", async (context) => {
  const rootManifest = structuredClone(manifest);
  rootManifest.artifactRoot = "payload.bin";
  rootManifest.checksums = [
    {
      path: "payload.bin",
      algorithm: "sha256",
      value: createHash("sha256").update("").digest("hex")
    }
  ];

  const fixture = await createDownloadProject(context, rootManifest, {
    payloadFile: ""
  });
  await assert.rejects(
    packageDownloads({
      context: fixture.context,
      options: {
        artifact: fixture.artifactPath,
        out: "artifacts/packages/downloads"
      }
    }),
    /artifact root is not a directory/
  );
});

test("downloads packaging rejects development artifacts", async (context) => {
  const development = structuredClone(manifest);
  development.releasable = false;
  development.provenance.adapter.profile = "development";
  const fixture = await createDownloadProject(context, development);

  await assert.rejects(
    packageDownloads({
      context: fixture.context,
      options: {
        artifact: fixture.artifactPath
      }
    }),
    /artifact that is not releasable/
  );
});

test("downloads packaging rejects artifact checksum mismatches", async (context) => {
  const fixture = await createDownloadProject(context, manifest, {
    executable: "tampered\n"
  });

  await assert.rejects(
    packageDownloads({
      context: fixture.context,
      options: {
        artifact: fixture.artifactPath
      }
    }),
    /artifact checksum mismatch/
  );
});

test("downloads package and publish scripts handle a valid artifact root", async (context) => {
  const fixture = await createDownloadProject(context, manifest, {
    executable: "fake exe\n"
  });
  const root = await mkdtemp(join(tmpdir(), "drydock-downloads-root-"));

  await writeFile(join(root, "stale.zip"), "old");

  const result = await packageDownloads({
    context: fixture.context,
    options: {
      artifact: fixture.artifactPath
    }
  });
  const out = result.outDir;

  assert.equal(result.zipName, "fixture-game-0.1.0-windows-x64.zip");
  await stat(join(out, result.zipName));
  await stat(join(out, `${result.zipName}.sha256`));
  await stat(join(out, "index.html"));
  assert.match(
    await readFile(join(out, result.zipName), "utf8"),
    /fixture-game-0\.1\.0-windows-x64\/win-unpacked\/fixture-game\.exe/
  );

  const checksum = await readFile(join(out, `${result.zipName}.sha256`), "utf8");
  assert.match(checksum, /^[a-f0-9]{64}  fixture-game-0\.1\.0-windows-x64\.zip\n$/);

  const linkedRoot = join(fixture.fixture.projectRoot, "linked-download-root");
  await symlink(root, linkedRoot, "dir");
  await assert.rejects(
    publishDownloads({
      context: fixture.context,
      options: {
        dryRun: true,
        root: linkedRoot,
        source: "artifacts/packages/downloads"
      }
    }),
    /must not be a symbolic link/
  );

  const resultPublish = await publishDownloads({
    context: fixture.context,
    options: {
      root,
      source: "artifacts/packages/downloads"
    }
  });
  const deployedRoot = join(root, "fixture-game-downloads");

  assert.equal(resultPublish.root, deployedRoot);
  await stat(join(deployedRoot, result.zipName));
  await stat(join(deployedRoot, `${result.zipName}.sha256`));
  await stat(join(deployedRoot, "index.html"));
  await stat(join(deployedRoot, ".drydock-channel"));
  await stat(join(root, "stale.zip"));
});

test("public CLI packages from outside the project working directory", async (context) => {
  const fixture = await createDownloadProject(context, manifest, {
    executable: "fake exe\n"
  });
  const output = captureStream();
  const errors = captureStream();
  const exitCode = await runCli([
    "package",
    "downloads",
    "--project",
    fixture.projectPath,
    "--artifact",
    fixture.artifactPath
  ], {
    invocationCwd: harnessRoot,
    stderr: errors,
    stdout: output
  });

  assert.equal(exitCode, 0, errors.value);
  assert.equal(errors.value, "");
  assert.match(
    output.value,
    /packaged download artifact: artifacts\/packages\/downloads\/fixture-game/
  );
});

test("public CLI publishes downloads from outside the project working directory", async (context) => {
  const fixture = await createDownloadProject(context, manifest, {
    executable: "fake exe\n"
  });
  await packageDownloads({
    context: fixture.context,
    options: {
      artifact: fixture.artifactPath
    }
  });
  const root = await mkdtemp(join(tmpdir(), "drydock-downloads-root-"));
  const output = captureStream();
  const errors = captureStream();

  const exitCode = await runCli([
    "publish",
    "downloads",
    "--project",
    fixture.projectPath,
    "--source",
    "artifacts/packages/downloads",
    "--root",
    root,
    "--dry-run"
  ], {
    invocationCwd: harnessRoot,
    stderr: errors,
    stdout: output
  });

  assert.equal(exitCode, 0, errors.value);
  assert.equal(errors.value, "");
  assert.match(output.value, /would publish .*fixture-game-downloads/);
});

test("downloads route verifier checks public package files and denied internal files", async () => {
  const responses = new Map([
    ["/", 200],
    ["/index.html", 200],
    ["/fixture-game-0.1.0-windows-x64.zip", 200],
    ["/fixture-game-0.1.0-windows-x64.zip.sha256", 200],
    ["/drydock-artifact.json", 404],
    ["/package.json", 404],
    ["/.git/config", 404],
    ["/.drydock-channel", 404]
  ]);

  const results = await verifyDownloads({
    baseUrl: "https://example.com/drydock-downloads/",
    name: "fixture-game-0.1.0-windows-x64.zip",
    fetchImpl: async (url, options = {}) => {
      const pathname = new URL(url).pathname.replace("/drydock-downloads", "") || "/";

      if (options.headers?.Range) {
        return new Response(Buffer.from("504b0304", "hex"), {
          status: 206
        });
      }

      return new Response(null, {
        status: responses.get(pathname) ?? 500
      });
    }
  });

  assert.equal(results.length, 8);
});

test("downloads route URL resolver preserves path-mounted prefixes", () => {
  assert.equal(
    resolveRouteUrl("https://example.com/drydock-downloads", "/index.html"),
    "https://example.com/drydock-downloads/index.html"
  );
});

async function createDownloadProject(
  context,
  selectedManifest,
  {
    executable,
    payloadFile
  } = {}
) {
  const fixture = await createMinimalProject(
    context,
    undefined,
    async ({ shippingRoot }) => {
      await mkdir(join(shippingRoot, "channels"));
      await writeFile(
        join(shippingRoot, "channels", "downloads.yaml"),
        "deploymentId: fixture-game-downloads\nroute: fixture-downloads\n"
      );
    }
  );
  const artifactRoot = join(
    fixture.projectRoot,
    "artifacts",
    "build",
    "windows-x64"
  );
  await mkdir(artifactRoot, {
    recursive: true
  });

  if (payloadFile !== undefined) {
    await writeFile(join(artifactRoot, "payload.bin"), payloadFile);
  }
  if (executable !== undefined) {
    await mkdir(join(artifactRoot, "win-unpacked"));
    await writeFile(
      join(artifactRoot, "win-unpacked", "fixture-game.exe"),
      executable
    );
  }

  await writeFile(
    join(artifactRoot, "drydock-artifact.json"),
    `${JSON.stringify(selectedManifest, null, 2)}\n`
  );
  const projectContext = await resolveProjectContext(fixture.projectPath, {
    invocationCwd: fixture.projectRoot,
    selectedHarnessRoot: harnessRoot
  });

  return {
    artifactPath: "artifacts/build/windows-x64/drydock-artifact.json",
    context: projectContext,
    fixture,
    projectPath: fixture.projectPath
  };
}

function captureStream() {
  return {
    value: "",
    write(chunk) {
      this.value += chunk;
    }
  };
}
