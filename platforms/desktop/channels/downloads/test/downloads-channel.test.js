import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import yauzl from "yauzl";
import yazl from "yazl";
import {
  defaultZipName,
  packageDownloads,
  parsePackageArgs,
  parseVerifyArgs,
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
  assert.match(caddy, /DRYDOCK_HOSTNAME/);
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

  assert.deepEqual(parseVerifyArgs([], {
    DRYDOCK_DOWNLOADS_URL: "https://example.com/downloads/"
  }), {
    baseUrl: "https://example.com/downloads/"
  });

  assert.throws(() => parseVerifyArgs(["--name"]), /--name requires/);
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
    /artifact root must be a real directory/
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

test("downloads packaging rejects a symlinked output ancestor", async (context) => {
  const fixture = await createDownloadProject(context, manifest, {
    executable: "fake exe\n"
  });
  const external = await mkdtemp(join(tmpdir(), "drydock-downloads-external-"));
  context.after(() => rm(external, {
    force: true,
    recursive: true
  }));
  const externalOutput = join(external, "downloads");
  await mkdir(externalOutput);
  await symlink(
    external,
    join(fixture.fixture.projectRoot, "artifacts", "packages"),
    "dir"
  );

  await assert.rejects(
    packageDownloads({
      context: fixture.context,
      options: {
        artifact: fixture.artifactPath,
        out: "artifacts/packages/downloads"
      }
    }),
    /downloads output path must not contain symbolic links/
  );
});

test("downloads packaging rejects output nested inside its input artifact", async (context) => {
  const fixture = await createDownloadProject(context, manifest, {
    executable: "fake exe\n"
  });
  const nestedOutput = join(
    fixture.fixture.projectRoot,
    "artifacts/build/windows-x64/packages/downloads"
  );

  await assert.rejects(
    packageDownloads({
      context: fixture.context,
      options: {
        artifact: fixture.artifactPath,
        out: "artifacts/build/windows-x64/packages/downloads"
      }
    }),
    /downloads output must not overlap the input artifact/
  );
  await assert.rejects(stat(nestedOutput), {
    code: "ENOENT"
  });
});

test("downloads packaging includes a dot-root artifact manifest once", async (context) => {
  const dotRootManifest = structuredClone(manifest);
  dotRootManifest.artifactRoot = ".";
  dotRootManifest.executable = "payload.bin";
  dotRootManifest.checksums = [
    {
      path: "payload.bin",
      algorithm: "sha256",
      value: createHash("sha256").update("payload\n").digest("hex")
    }
  ];
  const fixture = await createDownloadProject(context, dotRootManifest, {
    payloadFile: "payload\n"
  });
  const result = await packageDownloads({
    context: fixture.context,
    options: {
      artifact: fixture.artifactPath
    }
  });
  const entries = await zipEntryNames(result.zipPath);

  assert.equal(
    entries.filter((name) => name.endsWith("/drydock-artifact.json")).length,
    1
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
  await writeFile(
    join(out, "index.html"),
    "<!doctype html><script>globalThis.tampered = true</script>\n"
  );

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
  const publishedIndex = await readFile(join(deployedRoot, "index.html"), "utf8");
  assert.match(publishedIndex, /fixture-game-0\.1\.0-windows-x64\.zip/);
  assert.doesNotMatch(publishedIndex, /tampered/);
  await stat(join(deployedRoot, ".drydock-channel"));
  await stat(join(root, "stale.zip"));
});

test("downloads publishing rejects a packaged development artifact", async (context) => {
  const development = structuredClone(manifest);
  development.releasable = false;
  development.provenance.adapter.profile = "development";
  const fixture = await createDownloadProject(context, development, {
    executable: "fake exe\n"
  });
  const source = join(
    fixture.fixture.projectRoot,
    "artifacts/packages/handcrafted"
  );
  await writeHandcraftedDownloadsPackage(source, development);
  const root = await mkdtemp(join(tmpdir(), "drydock-downloads-root-"));

  await assert.rejects(
    publishDownloads({
      context: fixture.context,
      options: {
        dryRun: true,
        root,
        source: "artifacts/packages/handcrafted"
      }
    }),
    /downloads publishing rejects a non-releasable artifact/
  );
});

test("downloads publishing verifies archived payload checksums", async (context) => {
  const fixture = await createDownloadProject(context, manifest, {
    executable: "fake exe\n"
  });
  const source = join(
    fixture.fixture.projectRoot,
    "artifacts/packages/tampered"
  );
  await writeHandcraftedDownloadsPackage(source, manifest);
  const root = await mkdtemp(join(tmpdir(), "drydock-downloads-root-"));

  await assert.rejects(
    publishDownloads({
      context: fixture.context,
      options: {
        dryRun: true,
        root,
        source: "artifacts/packages/tampered"
      }
    }),
    /downloads packaged artifact checksum mismatch: win-unpacked\/fixture-game\.exe/
  );
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
    baseUrl: "https://example.com/downloads/",
    name: "fixture-game-0.1.0-windows-x64.zip",
    fetchImpl: async (url, options = {}) => {
      const pathname = new URL(url).pathname.replace("/downloads", "") || "/";

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
    resolveRouteUrl("https://example.com/downloads", "/index.html"),
    "https://example.com/downloads/index.html"
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

async function writeHandcraftedDownloadsPackage(source, selectedManifest) {
  const zipName = defaultZipName(selectedManifest);
  const prefix = zipName.replace(/\.zip$/u, "");
  const zipPath = join(source, zipName);
  await mkdir(source, {
    recursive: true
  });

  const zip = new yazl.ZipFile();
  zip.addBuffer(
    Buffer.from("fake executable\n"),
    `${prefix}/win-unpacked/fixture-game.exe`
  );
  zip.addBuffer(
    Buffer.from(`${JSON.stringify(selectedManifest, null, 2)}\n`),
    `${prefix}/drydock-artifact.json`
  );
  const written = new Promise((resolveWrite, rejectWrite) => {
    zip.outputStream
      .pipe(createWriteStream(zipPath))
      .on("close", resolveWrite)
      .on("error", rejectWrite);
  });
  zip.end();
  await written;

  const digest = createHash("sha256")
    .update(await readFile(zipPath))
    .digest("hex");
  await writeFile(join(source, `${zipName}.sha256`), `${digest}  ${zipName}\n`);
  await writeFile(join(source, "index.html"), "<!doctype html>\n");
}

function zipEntryNames(path) {
  return new Promise((resolveEntries, rejectEntries) => {
    yauzl.open(path, {
      lazyEntries: true
    }, (error, zip) => {
      if (error) {
        rejectEntries(error);
        return;
      }

      const entries = [];
      zip.on("error", rejectEntries);
      zip.on("entry", (entry) => {
        entries.push(entry.fileName);
        zip.readEntry();
      });
      zip.on("end", () => resolveEntries(entries));
      zip.readEntry();
    });
  });
}
