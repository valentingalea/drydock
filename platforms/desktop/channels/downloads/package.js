#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep
} from "node:path";
import { fileURLToPath } from "node:url";
import yazl from "yazl";
import {
  prepareArtifactOutputDirectory,
  resolveArtifactManifestPath,
  validateArtifactManifest,
  verifyArtifactChecksums
} from "../../../../tools/artifacts.js";
import { resolveProjectPath } from "../../../../tools/drydock.js";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const defaultOut = "artifacts/packages/downloads";

if (import.meta.url === `file://${process.argv[1]}`) {
  const { runCli } = await import("../../../../tools/drydock.js");
  process.exitCode = await runCli([
    "package",
    "downloads",
    ...process.argv.slice(2)
  ], {
    invocationCwd: process.cwd()
  });
}

export async function packageDownloadsCommand({
  args,
  context,
  stderr,
  stdout
}) {
  let options;
  try {
    options = parsePackageArgs(args);
  } catch (error) {
    stderr.write(`ERROR: ${error.message}\n`);
    return 2;
  }

  await packageDownloads({
    context,
    options,
    stdout
  });
  return 0;
}

export async function packageDownloads({
  context,
  options,
  stdout = process.stdout
}) {
  if (!context) {
    throw new TypeError("project context is required");
  }

  const manifestPath = await resolveArtifactManifestPath(
    context,
    options.artifact
  );
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  await validateManifest(manifest);
  await verifyArtifactChecksums(manifest, manifestPath);

  const sourceRoot = resolve(dirname(manifestPath), manifest.artifactRoot);
  await assertDirectory(sourceRoot);

  const requestedOutDir = resolveProjectPath(
    context,
    options.out ?? defaultOut,
    "downloads output"
  );
  if (pathsOverlap(dirname(manifestPath), requestedOutDir)) {
    throw new Error("downloads output must not overlap the input artifact");
  }
  const outDir = await prepareArtifactOutputDirectory(
    context,
    options.out ?? defaultOut,
    "downloads output"
  );
  const zipName = options.name ?? defaultZipName(manifest);
  assertZipName(zipName);

  const zipPath = resolve(outDir, zipName);
  const checksumPath = resolve(outDir, `${zipName}.sha256`);
  const indexPath = resolve(outDir, "index.html");
  const prefix = zipName.replace(/\.zip$/u, "");

  await createZip({
    artifactRoot: manifest.artifactRoot,
    manifestPath,
    prefix,
    sourceRoot,
    zipPath
  });

  const digest = await sha256File(zipPath);
  await writeFile(checksumPath, `${digest}  ${zipName}\n`);
  await writeFile(indexPath, await renderIndex({
    checksumName: `${zipName}.sha256`,
    digest,
    manifest,
    size: (await stat(zipPath)).size,
    zipName
  }));

  stdout.write(
    `packaged download artifact: ${relative(context.projectRoot, zipPath)}\n`
  );
  return {
    checksumPath,
    digest,
    indexPath,
    manifest,
    outDir,
    zipName,
    zipPath
  };
}

export function parsePackageArgs(argv) {
  const options = {};
  const seen = new Set();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--artifact") {
      rejectDuplicate(seen, argument);
      options.artifact = requireValue(argv, ++index, argument);
    } else if (argument === "--out") {
      rejectDuplicate(seen, argument);
      options.out = requireValue(argv, ++index, argument);
    } else if (argument === "--name") {
      rejectDuplicate(seen, argument);
      options.name = requireValue(argv, ++index, argument);
    } else {
      throw new Error(`unknown downloads package argument: ${argument}`);
    }
  }

  if (!options.artifact) {
    throw new Error("--artifact is required");
  }
  return options;
}

function rejectDuplicate(seen, flag) {
  if (seen.has(flag)) {
    throw new Error(`${flag} may be provided only once`);
  }
  seen.add(flag);
}

export async function verifyDownloads(options = {}) {
  const baseUrl = options.baseUrl ?? process.env.DRYDOCK_DOWNLOADS_URL;

  if (!baseUrl) {
    throw new Error("usage: node verify.js --base-url https://game.example/downloads/");
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5000;
  const zipName = options.name;
  if (!zipName) {
    throw new Error("downloads verification requires --name");
  }
  assertZipName(zipName);
  const checks = [
    { path: "/", status: 200 },
    { path: "/index.html", status: 200 },
    { path: `/${zipName}`, status: 200 },
    { path: `/${zipName}.sha256`, status: 200 },
    { path: "/drydock-artifact.json", status: 404 },
    { path: "/package.json", status: 404 },
    { path: "/.git/config", status: 404 },
    { path: "/.drydock-channel", status: 404 }
  ];
  const results = [];

  for (const check of checks) {
    const url = resolveRouteUrl(baseUrl, check.path);
    const response = await fetchImpl(url, {
      method: "HEAD",
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs)
    });

    if (response.status !== check.status) {
      throw new Error(`download route check failed for ${url}: expected ${check.status}, got ${response.status}`);
    }

    results.push({ path: check.path, status: response.status, url });
    console.log(`${response.status} ${url}`);
  }

  const zipUrl = resolveRouteUrl(baseUrl, `/${zipName}`);
  const signature = new Uint8Array(await (await fetchImpl(zipUrl, {
    headers: {
      Range: "bytes=0-3"
    },
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs)
  })).arrayBuffer());

  if (Buffer.from(signature).toString("hex") !== "504b0304") {
    throw new Error(`download zip signature check failed for ${zipUrl}`);
  }

  console.log("verified downloads route");
  return results;
}

export function parseVerifyArgs(argv, env = {}) {
  const options = {};
  const seen = new Set();

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--") {
      continue;
    } else if (arg === "--name") {
      rejectDuplicate(seen, arg);
      options.name = requireValue(argv, ++i, arg);
    } else if (arg === "--base-url") {
      rejectDuplicate(seen, arg);
      options.baseUrl = requireValue(argv, ++i, arg);
    } else if (arg === "--timeout-ms") {
      rejectDuplicate(seen, arg);
      options.timeoutMs = parseTimeout(requireValue(argv, ++i, arg));
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown argument: ${arg}`);
    } else {
      throw new Error(`unexpected positional argument: ${arg}`);
    }
  }

  if (!options.baseUrl && env.DRYDOCK_DOWNLOADS_URL) {
    options.baseUrl = env.DRYDOCK_DOWNLOADS_URL;
  }

  return options;
}

export function defaultZipName(manifest) {
  return [
    manifest.productId,
    manifest.version,
    manifest.platform,
    manifest.arch
  ].join("-") + ".zip";
}

export function resolveRouteUrl(baseUrl, path) {
  const base = new URL(baseUrl);
  const baseHref = base.href.endsWith("/") ? base.href : `${base.href}/`;

  if (path === "/") {
    return baseHref;
  }

  return new URL(path.replace(/^\/+/u, ""), baseHref).href;
}

async function createZip({ artifactRoot, manifestPath, prefix, sourceRoot, zipPath }) {
  const zip = new yazl.ZipFile();
  const files = await listFiles(sourceRoot);
  const archiveRoot = join(prefix, artifactRoot).split("\\").join("/");

  for (const filePath of files) {
    if (filePath === manifestPath) {
      continue;
    }
    const archivePath = join(archiveRoot, relative(sourceRoot, filePath)).split("\\").join("/");
    zip.addFile(filePath, archivePath);
  }

  zip.addFile(manifestPath, `${prefix}/drydock-artifact.json`);
  zip.end();

  await new Promise((resolveZip, rejectZip) => {
    zip.outputStream
      .pipe(createWriteStream(zipPath))
      .on("close", resolveZip)
      .on("error", rejectZip);
  });
}

async function renderIndex({ checksumName, digest, manifest, size, zipName }) {
  const sizeMb = (size / 1024 / 1024).toFixed(1);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Drydock Downloads</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 2rem; max-width: 56rem; line-height: 1.5; }
      code { background: #f2f2f2; padding: 0.1rem 0.25rem; }
    </style>
  </head>
  <body>
    <h1>Drydock Downloads</h1>
    <ul>
      <li><a href="${escapeHtml(zipName)}">${escapeHtml(zipName)}</a> (${sizeMb} MB)</li>
      <li><a href="${escapeHtml(checksumName)}">${escapeHtml(checksumName)}</a></li>
    </ul>
    <p>Extract the zip and run <code>${escapeHtml(manifest.executable)}</code>.</p>
    <p>SHA-256: <code>${digest}</code></p>
    <p>This is an ${escapeHtml(manifest.signing.status)} proof-of-concept build.</p>
  </body>
</html>
`;
}

async function validateManifest(manifest) {
  await validateArtifactManifest(manifest, repoRoot);

  if (manifest.buildAdapter !== "electron") {
    throw new Error("downloads channel currently accepts Electron artifacts only");
  }
  if (manifest.releasable !== true) {
    throw new Error("downloads packaging rejects an artifact that is not releasable");
  }
}

async function sha256File(path) {
  const hash = createHash("sha256");

  await new Promise((resolveHash, rejectHash) => {
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", resolveHash)
      .on("error", rejectHash);
  });

  return hash.digest("hex");
}

async function assertDirectory(path) {
  const info = await stat(path);

  if (!info.isDirectory()) {
    throw new Error(`artifact root is not a directory: ${path}`);
  }
}

async function listFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const path = join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...await listFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }

  return files;
}

function assertZipName(name) {
  if (!/^[a-z0-9][a-z0-9._-]+\.zip$/u.test(name)) {
    throw new Error("--name must be a safe .zip filename");
  }
}

function pathsOverlap(left, right) {
  const pathFromLeft = relative(left, right);
  const pathFromRight = relative(right, left);
  return pathAtOrWithin(pathFromLeft) || pathAtOrWithin(pathFromRight);
}

function pathAtOrWithin(path) {
  return (
    path === ""
    || (
      path !== ".."
      && !path.startsWith(`..${sep}`)
      && !isAbsolute(path)
    )
  );
}

function parseTimeout(value) {
  const timeoutMs = Number.parseInt(value, 10);

  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) {
    throw new Error("--timeout-ms must be an integer from 100 to 60000");
  }

  return timeoutMs;
}

function requireValue(argv, index, flag) {
  const value = argv[index];

  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }

  return value;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
