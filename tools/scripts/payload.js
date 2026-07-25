import { execFile } from "node:child_process";
import { cp, mkdir, readFile, stat } from "node:fs/promises";
import { dirname, posix, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const descriptorPath = "game/drydock-payload.json";

export async function loadPayload(repoRoot) {
  const path = resolve(repoRoot, descriptorPath);
  const payload = JSON.parse(await readFile(path, "utf8"));

  if (payload.schemaVersion !== 1) {
    throw new Error(`unsupported payload schemaVersion: ${payload.schemaVersion}`);
  }

  for (const field of ["gameId", "productName", "executableName", "appId", "entrypoint"]) {
    if (typeof payload[field] !== "string" || payload[field].length === 0) {
      throw new Error(`payload descriptor requires ${field}`);
    }
  }

  if (!Array.isArray(payload.entries) || payload.entries.length === 0) {
    throw new Error("payload descriptor requires runtime entries");
  }

  const entries = [];

  for (const entry of payload.entries) {
    assertRelativePath(entry.source, "payload source");
    assertRelativePath(entry.target, "payload target");

    const sourcePath = resolveWithin(repoRoot, entry.source);
    const sourceStat = await stat(sourcePath);
    entries.push({
      ...entry,
      sourcePath,
      directory: sourceStat.isDirectory()
    });
  }

  const targets = new Set(entries.map((entry) => entry.target));

  if (!targets.has(payload.entrypoint)) {
    throw new Error(`payload entrypoint is not staged: ${payload.entrypoint}`);
  }

  return {
    ...payload,
    descriptorPath,
    entries
  };
}

export async function stagePayload(payload, outDir) {
  for (const entry of payload.entries) {
    const targetPath = resolveWithin(outDir, entry.target);
    await mkdir(dirname(targetPath), { recursive: true });
    await cp(entry.sourcePath, targetPath, {
      recursive: entry.directory,
      dereference: true,
      force: true
    });
  }
}

export function resolvePayloadRequest(payload, pathname) {
  const decoded = decodeURIComponent(pathname);
  const requested = decoded === "/" ? "/index.html" : decoded;
  const withIndex = requested.endsWith("/") ? `${requested}index.html` : requested;
  const normalized = posix.normalize(withIndex).replace(/^\/+/, "");

  if (
    normalized === ""
    || normalized === "."
    || normalized === ".."
    || normalized.startsWith("../")
    || normalized.includes("\\")
  ) {
    return null;
  }

  for (const entry of [...payload.entries].reverse()) {
    if (!entry.directory && normalized === entry.target) {
      return entry.sourcePath;
    }

    if (entry.directory && normalized.startsWith(`${entry.target}/`)) {
      const suffix = normalized.slice(entry.target.length + 1);
      return resolveWithin(entry.sourcePath, suffix);
    }
  }

  return null;
}

export async function readEngineRevision(repoRoot, payload) {
  const engineRoot = resolveWithin(repoRoot, payload.engine.path);
  const [{ stdout: commit }, { stdout: remote }] = await Promise.all([
    execFileAsync("git", ["-C", engineRoot, "rev-parse", "HEAD"]),
    execFileAsync("git", ["-C", engineRoot, "remote", "get-url", "origin"])
  ]);

  return {
    name: payload.engine.name,
    path: payload.engine.path,
    release: payload.engine.release,
    commit: commit.trim(),
    remote: remote.trim(),
    threeRevision: payload.engine.threeRevision
  };
}

export async function verifyPayloadSubmodule(repoRoot, mode = "--strict") {
  const verifier = resolveWithin(repoRoot, "engine/tools/verify-submodule.sh");
  const { stdout, stderr } = await execFileAsync(verifier, [mode]);

  if (stdout.trim()) console.log(stdout.trim());
  if (stderr.trim()) console.error(stderr.trim());
}

function assertRelativePath(value, label) {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.startsWith("/")
    || value.includes("\\")
    || value.split("/").includes("..")
  ) {
    throw new Error(`${label} must be a safe repo-relative path: ${value}`);
  }
}

function resolveWithin(root, path) {
  const absolute = resolve(root, path);
  const within = relative(root, absolute);

  if (within === "" || (!within.startsWith("..") && !within.includes(`..${sep}`))) {
    return absolute;
  }

  throw new Error(`path escapes root: ${path}`);
}
