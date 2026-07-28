#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile
} from "node:fs/promises";
import {
  isAbsolute,
  relative,
  resolve,
  sep
} from "node:path";
import yauzl from "yauzl";
import {
  loadChannelPolicy,
  validateArtifactManifest
} from "../../../../tools/artifacts.js";
import { resolveProjectPath } from "../../../../tools/drydock.js";

const maxArtifactManifestBytes = 1024 * 1024;

if (import.meta.url === `file://${process.argv[1]}`) {
  const { runCli } = await import("../../../../tools/drydock.js");
  process.exitCode = await runCli([
    "publish",
    "downloads",
    ...process.argv.slice(2)
  ], {
    invocationCwd: process.cwd()
  });
}

export async function publishDownloadsCommand({
  args,
  context,
  stderr,
  stdout
}) {
  let options;
  try {
    options = parsePublishArgs(args);
  } catch (error) {
    stderr.write(`ERROR: ${error.message}\n`);
    return 2;
  }

  await publishDownloads({
    context,
    options,
    stdout
  });
  return 0;
}

export async function publishDownloads({
  context,
  env = process.env,
  options,
  stdout = process.stdout
}) {
  if (!context) {
    throw new TypeError("project context is required");
  }

  const source = await resolvePackageSource(context, options.source);
  const policy = await loadChannelPolicy({
    channel: "downloads",
    context,
    value: options.channelPolicy
  });
  const deploymentId = deploymentIdFromPolicy(policy);
  const rootBase = await resolveOperationalRoot(
    options.root ?? env.DRYDOCK_DOWNLOADS_ROOT
  );
  const root = resolve(rootBase, deploymentId);
  const files = await verifiedPublicFiles(
    source,
    context.harnessRoot
  );

  if (options.dryRun) {
    stdout.write(
      `would publish ${files.length} download files: ${source} -> ${root}\n`
    );
    return {
      deploymentId,
      dryRun: true,
      files,
      root,
      source
    };
  }

  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });

  for (const file of files) {
    await cp(resolve(source, file), resolve(root, file));
  }

  await writeFile(resolve(root, ".drydock-channel"), "downloads\n");
  stdout.write(`published download files: ${source} -> ${root}\n`);
  return {
    deploymentId,
    dryRun: false,
    files,
    root,
    source
  };
}

export function parsePublishArgs(argv) {
  const options = {};
  const seen = new Set();

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--source") {
      rejectDuplicate(seen, argument);
      options.source = requireValue(argv, ++index, argument);
    } else if (argument === "--root") {
      rejectDuplicate(seen, argument);
      options.root = requireValue(argv, ++index, argument);
    } else if (argument === "--channel-policy") {
      rejectDuplicate(seen, argument);
      options.channelPolicy = requireValue(argv, ++index, argument);
    } else if (argument === "--dry-run") {
      rejectDuplicate(seen, argument);
      options.dryRun = true;
    } else {
      throw new Error(`unknown downloads publish argument: ${argument}`);
    }
  }

  if (!options.source) {
    throw new Error("--source is required");
  }
  return options;
}

async function resolvePackageSource(context, value) {
  const requested = resolveProjectPath(context, value, "downloads source");
  let artifactRoot;
  let source;
  try {
    artifactRoot = await realpath(context.artifactRoot);
    source = await realpath(requested);
  } catch (error) {
    throw new Error(`cannot resolve downloads source: ${error.message}`);
  }

  if (
    source !== requested
    || !pathWithin(artifactRoot, source)
  ) {
    throw new Error(
      "downloads source must be a real directory below project artifacts"
    );
  }
  if (!(await lstat(source)).isDirectory()) {
    throw new Error("downloads source must be a directory");
  }
  return source;
}

function deploymentIdFromPolicy(policy) {
  const deploymentId = policy?.snapshot?.deploymentId;
  if (
    typeof deploymentId !== "string"
    || !/^[a-z0-9][a-z0-9._-]*$/u.test(deploymentId)
  ) {
    throw new Error(
      "downloads channel policy requires a valid deploymentId"
    );
  }
  return deploymentId;
}

async function resolveOperationalRoot(value) {
  if (!value) {
    throw new Error(
      "downloads publish requires --root or DRYDOCK_DOWNLOADS_ROOT"
    );
  }
  if (!isAbsolute(value)) {
    throw new Error("downloads operational root must be an absolute path");
  }

  const root = resolve(value);
  if (root === resolve(root, "..")) {
    throw new Error(
      "downloads operational root must not be a filesystem root"
    );
  }

  const info = await lstat(root);
  if (info.isSymbolicLink()) {
    throw new Error(
      "downloads operational root must not be a symbolic link"
    );
  }
  if (!info.isDirectory()) {
    throw new Error("downloads operational root must be a directory");
  }
  return realpath(root);
}

async function verifiedPublicFiles(source, harnessRoot) {
  const entries = await readdir(source, {
    withFileTypes: true
  });
  const files = entries
    .filter((entry) => (
      entry.isFile()
      && (
        entry.name === "index.html"
        || entry.name.endsWith(".zip")
        || entry.name.endsWith(".zip.sha256")
      )
    ))
    .map((entry) => entry.name)
    .sort();
  const zipNames = files.filter((name) => name.endsWith(".zip"));

  if (!files.includes("index.html") || zipNames.length === 0) {
    throw new Error(
      "downloads source requires index.html and at least one zip"
    );
  }

  for (const zipName of zipNames) {
    const checksumName = `${zipName}.sha256`;
    if (!files.includes(checksumName)) {
      throw new Error(`downloads source is missing ${checksumName}`);
    }
    await verifyChecksum(source, zipName, checksumName);
    const zipPath = resolve(source, zipName);
    const { manifest, prefix } = await readPackagedArtifactManifest(zipPath);
    await validateArtifactManifest(manifest, harnessRoot);
    if (manifest.buildAdapter !== "electron") {
      throw new Error(
        `downloads package contains an unsupported artifact: ${zipName}`
      );
    }
    if (manifest.releasable !== true) {
      throw new Error(
        `downloads publishing rejects a non-releasable artifact: ${zipName}`
      );
    }
    await verifyPackagedArtifactPayload(zipPath, manifest, prefix);
  }
  return files;
}

async function readPackagedArtifactManifest(zipPath) {
  const zip = await openZip(zipPath);

  return new Promise((resolveManifest, rejectManifest) => {
    let manifestContents = null;
    let manifestPrefix = null;
    let settled = false;

    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      zip.close();
      rejectManifest(error);
    };

    zip.on("error", fail);
    zip.on("entry", (entry) => {
      if (!/^[^/]+\/drydock-artifact\.json$/u.test(entry.fileName)) {
        zip.readEntry();
        return;
      }
      if (manifestContents !== null) {
        fail(new Error("downloads package contains duplicate artifact manifests"));
        return;
      }
      if (entry.uncompressedSize > maxArtifactManifestBytes) {
        fail(new Error("downloads package artifact manifest is too large"));
        return;
      }
      manifestPrefix = entry.fileName.slice(
        0,
        -"/drydock-artifact.json".length
      );

      zip.openReadStream(entry, (error, stream) => {
        if (error) {
          fail(error);
          return;
        }

        const chunks = [];
        let size = 0;
        stream.on("data", (chunk) => {
          size += chunk.length;
          if (size > maxArtifactManifestBytes) {
            stream.destroy(
              new Error("downloads package artifact manifest is too large")
            );
            return;
          }
          chunks.push(chunk);
        });
        stream.on("error", fail);
        stream.on("end", () => {
          manifestContents = Buffer.concat(chunks);
          zip.readEntry();
        });
      });
    });
    zip.on("end", () => {
      if (settled) {
        return;
      }
      if (manifestContents === null) {
        fail(new Error("downloads package is missing its artifact manifest"));
        return;
      }

      try {
        const manifest = JSON.parse(manifestContents.toString("utf8"));
        settled = true;
        resolveManifest({
          manifest,
          prefix: manifestPrefix
        });
      } catch (error) {
        fail(new Error(
          `downloads package artifact manifest is invalid JSON: ${error.message}`
        ));
      }
    });

    zip.readEntry();
  });
}

async function verifyPackagedArtifactPayload(zipPath, manifest, prefix) {
  const expected = new Map();
  for (const checksum of manifest.checksums) {
    const entryName = `${prefix}/${checksum.path}`;
    if (expected.has(entryName)) {
      throw new Error(
        `downloads package contains a duplicate artifact checksum path: ${checksum.path}`
      );
    }
    expected.set(entryName, checksum);
  }

  const manifestEntry = `${prefix}/drydock-artifact.json`;
  const zip = await openZip(zipPath);

  return new Promise((resolveVerification, rejectVerification) => {
    const seen = new Set();
    let settled = false;

    const fail = (error) => {
      if (settled) {
        return;
      }
      settled = true;
      zip.close();
      rejectVerification(error);
    };

    zip.on("error", fail);
    zip.on("entry", (entry) => {
      if (entry.fileName.endsWith("/")) {
        zip.readEntry();
        return;
      }
      if (entry.fileName === manifestEntry) {
        zip.readEntry();
        return;
      }

      const checksum = expected.get(entry.fileName);
      if (!checksum) {
        fail(new Error(
          `downloads package contains an unchecksummed artifact file: ${entry.fileName}`
        ));
        return;
      }
      if (seen.has(entry.fileName)) {
        fail(new Error(
          `downloads package contains a duplicate artifact file: ${entry.fileName}`
        ));
        return;
      }
      seen.add(entry.fileName);

      zip.openReadStream(entry, (error, stream) => {
        if (error) {
          fail(error);
          return;
        }

        const hash = createHash(checksum.algorithm);
        stream.on("data", (chunk) => hash.update(chunk));
        stream.on("error", fail);
        stream.on("end", () => {
          const actual = hash.digest("hex");
          if (actual !== checksum.value) {
            fail(new Error(
              `downloads packaged artifact checksum mismatch: ${checksum.path}`
            ));
            return;
          }
          zip.readEntry();
        });
      });
    });
    zip.on("end", () => {
      if (settled) {
        return;
      }

      for (const [entryName, checksum] of expected) {
        if (!seen.has(entryName)) {
          fail(new Error(
            `downloads package is missing checksummed artifact file: ${checksum.path}`
          ));
          return;
        }
      }

      settled = true;
      resolveVerification();
    });

    zip.readEntry();
  });
}

function openZip(path) {
  return new Promise((resolveZip, rejectZip) => {
    yauzl.open(path, {
      lazyEntries: true,
      validateEntrySizes: true
    }, (error, zip) => {
      if (error) {
        rejectZip(error);
        return;
      }
      resolveZip(zip);
    });
  });
}

async function verifyChecksum(source, zipName, checksumName) {
  const line = await readFile(resolve(source, checksumName), "utf8");
  const match = /^([a-f0-9]{64})  ([a-z0-9][a-z0-9._-]+\.zip)\n$/u.exec(line);
  if (!match || match[2] !== zipName) {
    throw new Error(`invalid download checksum file: ${checksumName}`);
  }

  const hash = createHash("sha256");
  for await (const chunk of createReadStream(resolve(source, zipName))) {
    hash.update(chunk);
  }
  const actual = hash.digest("hex");
  if (actual !== match[1]) {
    throw new Error(`download checksum mismatch: ${zipName}`);
  }
}

function pathWithin(root, candidate) {
  const path = relative(root, candidate);
  return path !== ""
    && path !== ".."
    && !path.startsWith(`..${sep}`)
    && !isAbsolute(path);
}

function rejectDuplicate(seen, flag) {
  if (seen.has(flag)) {
    throw new Error(`${flag} may be provided only once`);
  }
  seen.add(flag);
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}
