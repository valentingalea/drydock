import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  defaultZipName,
  packageDownloads,
  parseArgs,
  publishDownloads,
  resolveRouteUrl,
  verifyDownloads
} from "../package.js";

const manifest = {
  schemaVersion: 1,
  gameId: "line-engine-calibration",
  version: "0.1.0",
  buildNumber: 100,
  engine: "electron",
  platform: "windows",
  arch: "x64",
  artifactRoot: "win-unpacked",
  executable: "win-unpacked/line-engine-calibration.exe",
  bundleId: "dev.drydock.line-engine-calibration",
  packageId: null,
  signing: {
    status: "unsigned"
  },
  capabilities: [
    "storage"
  ],
  checksums: []
};

test("downloads Caddy template exposes only the current package and checksum", async () => {
  const caddy = await readFile(join(import.meta.dirname, "../caddy.path.example"), "utf8");

  assert.match(caddy, /handle_path \/drydock-downloads\/\*/);
  assert.match(caddy, /root \* \/var\/www\/drydock-downloads/);
  assert.match(caddy, /\/\*\.zip/);
  assert.match(caddy, /\/\*\.zip\.sha256/);
  assert.match(caddy, /respond 404/);
  assert.doesNotMatch(caddy, /browse/);
  assert.doesNotMatch(caddy, /drydock-artifact\.json/);
});

test("parses downloads channel arguments", () => {
  assert.deepEqual(parseArgs([
    "artifacts/build/windows-x64/drydock-artifact.json",
    "--out",
    "artifacts/channels/downloads",
    "--name",
    "line-engine-calibration-0.1.0-windows-x64.zip"
  ]), {
    _: ["artifacts/build/windows-x64/drydock-artifact.json"],
    out: "artifacts/channels/downloads",
    name: "line-engine-calibration-0.1.0-windows-x64.zip"
  });

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
    "line-engine-calibration-0.1.0-windows-x64.zip"
  );
});

test("downloads package script creates zip, checksum, and index from an artifact manifest", async () => {
  const artifact = await mkdtemp(join(tmpdir(), "drydock-downloads-artifact-"));
  const out = await mkdtemp(join(tmpdir(), "drydock-downloads-out-"));

  await writeFile(join(artifact, "drydock-artifact.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(artifact, "win-unpacked"), "");
  await assert.rejects(
    packageDownloads({
      _: [join(artifact, "drydock-artifact.json")],
      out
    }),
    /artifact root is not a directory/
  );
});

test("downloads package and publish scripts handle a valid artifact root", async () => {
  const artifact = await mkdtemp(join(tmpdir(), "drydock-downloads-artifact-"));
  const out = await mkdtemp(join(tmpdir(), "drydock-downloads-out-"));
  const root = await mkdtemp(join(tmpdir(), "drydock-downloads-root-"));

  await writeFile(join(artifact, "drydock-artifact.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(join(root, "stale.zip"), "old");
  await mkdir(join(artifact, "win-unpacked"), { recursive: true });
  await writeFile(join(artifact, "win-unpacked/line-engine-calibration.exe"), "fake exe\n");

  const result = await packageDownloads({
    _: [join(artifact, "drydock-artifact.json")],
    out
  });

  assert.equal(result.zipName, "line-engine-calibration-0.1.0-windows-x64.zip");
  await stat(join(out, result.zipName));
  await stat(join(out, `${result.zipName}.sha256`));
  await stat(join(out, "index.html"));
  assert.match(
    await readFile(join(out, result.zipName), "utf8"),
    /line-engine-calibration-0\.1\.0-windows-x64\/win-unpacked\/line-engine-calibration\.exe/
  );

  const checksum = await readFile(join(out, `${result.zipName}.sha256`), "utf8");
  assert.match(checksum, /^[a-f0-9]{64}  line-engine-calibration-0\.1\.0-windows-x64\.zip\n$/);

  await publishDownloads({
    _: [out],
    root
  });

  await stat(join(root, result.zipName));
  await stat(join(root, `${result.zipName}.sha256`));
  await stat(join(root, "index.html"));
  await stat(join(root, ".drydock-channel"));
  await assert.rejects(stat(join(root, "stale.zip")), { code: "ENOENT" });
});

test("downloads route verifier checks public package files and denied internal files", async () => {
  const responses = new Map([
    ["/", 200],
    ["/index.html", 200],
    ["/line-engine-calibration-0.1.0-windows-x64.zip", 200],
    ["/line-engine-calibration-0.1.0-windows-x64.zip.sha256", 200],
    ["/drydock-artifact.json", 404],
    ["/package.json", 404],
    ["/.git/config", 404],
    ["/.drydock-channel", 404]
  ]);

  const results = await verifyDownloads({
    baseUrl: "https://example.com/drydock-downloads/",
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
