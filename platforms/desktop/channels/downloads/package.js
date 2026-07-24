#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import yazl from "yazl";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const defaultOut = "artifacts/channels/downloads";

if (import.meta.url === `file://${process.argv[1]}`) {
  await packageDownloads(parseArgs(process.argv.slice(2)));
}

export async function packageDownloads(options = {}) {
  if (!options.manifest && !options._[0]) {
    throw new Error("usage: node package.js <drydock-artifact.json> [--out path] [--name file.zip]");
  }

  const manifestPath = await resolveExistingPath(options.manifest ?? options._[0]);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  await validateManifest(manifest);

  const sourceRoot = resolve(dirname(manifestPath), manifest.artifactRoot);
  await assertDirectory(sourceRoot);

  const outDir = resolve(repoRoot, options.out ?? defaultOut);
  const zipName = options.name ?? defaultZipName(manifest);
  assertZipName(zipName);

  const zipPath = resolve(outDir, zipName);
  const checksumPath = resolve(outDir, `${zipName}.sha256`);
  const indexPath = resolve(outDir, "index.html");
  const prefix = zipName.replace(/\.zip$/u, "");

  await mkdir(outDir, { recursive: true });
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

  console.log(`packaged download artifact: ${relative(repoRoot, zipPath)}`);
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

export async function publishDownloads(options = {}) {
  if (!options.source && !options._[0]) {
    throw new Error("usage: node publish.js <downloads-dir> [--root path] [--dry-run]");
  }

  const source = await resolveExistingPath(options.source ?? options._[0]);
  const root = resolve(options.root ?? "/var/www/drydock-downloads");
  const files = await publicDownloadFiles(source);

  if (options.dryRun) {
    console.log(`would publish ${files.length} download files: ${source} -> ${root}`);
    return { dryRun: true, files, root, source };
  }

  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });

  for (const file of files) {
    await cp(resolve(source, file), resolve(root, file));
  }

  await writeFile(resolve(root, ".drydock-channel"), "downloads\n");
  console.log(`published download files: ${source} -> ${root}`);
  return { dryRun: false, files, root, source };
}

export async function verifyDownloads(options = {}) {
  const baseUrl = options.baseUrl ?? process.env.DRYDOCK_DOWNLOADS_URL;

  if (!baseUrl) {
    throw new Error("usage: node verify.js --base-url https://example.com/drydock-downloads/");
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5000;
  const zipName = options.name ?? "drydock-placeholder-1.4.0-windows-x64.zip";
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

export function parseArgs(argv, env = {}) {
  const options = { _: [] };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--") {
      continue;
    } else if (arg === "--manifest") {
      options.manifest = requireValue(argv, ++i, arg);
    } else if (arg === "--source") {
      options.source = requireValue(argv, ++i, arg);
    } else if (arg === "--out") {
      options.out = requireValue(argv, ++i, arg);
    } else if (arg === "--root") {
      options.root = requireValue(argv, ++i, arg);
    } else if (arg === "--name") {
      options.name = requireValue(argv, ++i, arg);
    } else if (arg === "--base-url") {
      options.baseUrl = requireValue(argv, ++i, arg);
    } else if (arg === "--timeout-ms") {
      options.timeoutMs = parseTimeout(requireValue(argv, ++i, arg));
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg.startsWith("--")) {
      throw new Error(`unknown argument: ${arg}`);
    } else {
      options._.push(arg);
    }
  }

  if (!options.baseUrl && env.DRYDOCK_DOWNLOADS_URL) {
    options.baseUrl = env.DRYDOCK_DOWNLOADS_URL;
  }

  return options;
}

export function defaultZipName(manifest) {
  return [
    manifest.gameId,
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

async function publicDownloadFiles(source) {
  const files = [];

  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (!entry.isFile()) {
      continue;
    }

    if (
      entry.name === "index.html"
      || entry.name.endsWith(".zip")
      || entry.name.endsWith(".zip.sha256")
    ) {
      files.push(entry.name);
    }
  }

  files.sort();
  return files;
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
  const schema = JSON.parse(
    await readFile(resolve(repoRoot, "contracts/schemas/drydock-artifact.schema.json"), "utf8")
  );
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  const validate = ajv.compile(schema);

  if (!validate(manifest)) {
    throw new Error(`invalid artifact manifest: ${JSON.stringify(validate.errors, null, 2)}`);
  }

  if (manifest.engine !== "electron") {
    throw new Error("downloads channel currently accepts Electron artifacts only");
  }
}

async function resolveExistingPath(path) {
  const candidates = isAbsolute(path)
    ? [path]
    : [
        resolve(process.cwd(), path),
        resolve(repoRoot, path)
      ];

  for (const candidate of candidates) {
    if (await exists(candidate)) {
      return candidate;
    }
  }

  return candidates.at(-1);
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

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }

    throw error;
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
