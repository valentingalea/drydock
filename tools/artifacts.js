import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep
} from "node:path";
import { promisify } from "node:util";
import Ajv2020 from "ajv/dist/2020.js";
import YAML from "yaml";
import { resolveProjectPath } from "./drydock.js";

const execFileAsync = promisify(execFile);
let verificationSequence = 0;

export async function createArtifactProvenance({
  adapter,
  channelPolicy = null,
  releasePath,
  verified
}) {
  const { context } = verified.project;
  if (verified.profile === "release") {
    await verifyReleaseInputsTracked({
      channelPolicy,
      releasePath,
      verified
    });
    await verifyReleaseHarness(verified);
  }

  const [
    descriptorSha256,
    drydockCommit,
    projectRemote,
    projectTag,
    releaseSha256
  ] = await Promise.all([
    sha256File(context.projectPath),
    git(context.harnessRoot, "rev-parse", "HEAD"),
    optionalGit(context.projectRoot, "remote", "get-url", "origin"),
    exactTag(context.projectRoot, verified.projectRevision.commit),
    sha256File(releasePath)
  ]);
  const project = {
    descriptor: {
      path: portableRelative(context.projectRoot, context.projectPath),
      sha256: descriptorSha256
    },
    commit: verified.projectRevision.commit
  };

  const publicProjectRemote = sanitizeRemoteUrl(projectRemote);
  if (publicProjectRemote) {
    project.remote = publicProjectRemote;
  }
  if (projectTag) {
    project.tag = projectTag;
  }

  return {
    adapter: {
      id: adapter.id,
      package: adapter.package,
      profile: verified.profile
    },
    channelPolicy,
    components: componentProvenance(verified),
    drydock: {
      commit: drydockCommit
    },
    project,
    release: {
      path: portableRelative(context.projectRoot, releasePath),
      sha256: releaseSha256
    }
  };
}

export function sanitizeRemoteUrl(value) {
  if (!value) {
    return null;
  }

  let url;
  try {
    url = new URL(value);
  } catch {
    return value;
  }

  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.href;
}

async function verifyReleaseInputsTracked({
  channelPolicy = null,
  releasePath,
  verified
}) {
  const { context } = verified.project;
  const declarations = [
    {
      label: "project descriptor",
      path: context.projectPath
    },
    {
      label: "release declaration",
      path: releasePath
    }
  ];

  if (channelPolicy) {
    declarations.push({
      label: "channel policy",
      path: resolve(
        context.projectRoot,
        ...channelPolicy.path.split("/")
      )
    });
  }

  for (const declaration of declarations) {
    const path = portableRelative(context.projectRoot, declaration.path);
    let objectType;
    try {
      objectType = await git(
        context.projectRoot,
        "cat-file",
        "-t",
        `${verified.projectRevision.commit}:${path}`
      );
    } catch {
      throw new Error(
        `release ${declaration.label} must be tracked at project commit: ${path}`
      );
    }

    if (objectType !== "blob") {
      throw new Error(
        `release ${declaration.label} is not a tracked file at project commit: ${path}`
      );
    }
  }
}

export async function loadChannelPolicy({
  channel,
  context,
  value = `shipping/channels/${channel}.yaml`
}) {
  const requestedPath = resolveProjectPath(context, value, "channel policy");
  const policyRoot = resolve(context.shippingRoot, "channels");
  let canonicalPath;

  try {
    canonicalPath = await realpath(requestedPath);
  } catch (error) {
    throw new Error(`cannot resolve channel policy: ${error.message}`);
  }

  if (!pathWithin(policyRoot, canonicalPath)) {
    throw new Error("channel policy must resolve below shipping/channels");
  }

  const contents = await readFile(canonicalPath, "utf8");
  const snapshot = YAML.parse(contents);
  if (
    !snapshot
    || typeof snapshot !== "object"
    || Array.isArray(snapshot)
  ) {
    throw new Error("channel policy must contain a YAML object");
  }

  return {
    channel,
    path: portableRelative(context.projectRoot, canonicalPath),
    sha256: sha256(contents),
    snapshot
  };
}

export async function validateArtifactManifest(manifest, harnessRoot) {
  const schema = JSON.parse(
    await readFile(
      resolve(
        harnessRoot,
        "contracts/schemas/drydock-artifact.schema.json"
      ),
      "utf8"
    )
  );
  const validate = new Ajv2020({
    allErrors: true,
    strict: true
  }).compile(schema);

  if (!validate(manifest)) {
    throw new Error(
      `invalid artifact manifest: ${JSON.stringify(validate.errors, null, 2)}`
    );
  }
}

export async function verifyArtifactChecksums(manifest, manifestPath) {
  const manifestRoot = dirname(manifestPath);
  const actualPaths = await listArtifactPaths(manifestRoot, manifestPath);
  const expectedPaths = new Set();

  for (const checksum of manifest.checksums) {
    if (expectedPaths.has(checksum.path)) {
      throw new Error(`duplicate artifact checksum path: ${checksum.path}`);
    }
    expectedPaths.add(checksum.path);

    const filePath = resolve(
      manifestRoot,
      ...checksum.path.split("/")
    );
    if (!pathWithin(manifestRoot, filePath)) {
      throw new Error(`artifact checksum path escapes manifest root: ${checksum.path}`);
    }

    let contents;
    try {
      await assertRegularArtifactFile(manifestRoot, filePath, checksum.path);
      contents = await readFile(filePath);
    } catch (error) {
      throw new Error(
        `cannot read artifact checksum path ${checksum.path}: ${error.message}`
      );
    }

    const actual = createHash(checksum.algorithm)
      .update(contents)
      .digest("hex");
    if (actual !== checksum.value) {
      throw new Error(`artifact checksum mismatch: ${checksum.path}`);
    }
  }

  for (const path of actualPaths) {
    if (!expectedPaths.has(path)) {
      throw new Error(`artifact file is not checksummed: ${path}`);
    }
  }
  for (const path of expectedPaths) {
    if (!actualPaths.has(path)) {
      throw new Error(`artifact checksum path is not a regular file: ${path}`);
    }
  }
}

export async function resolveArtifactPayloadRoot(manifest, manifestPath) {
  const value = manifest?.artifactRoot;
  const segments = typeof value === "string" ? value.split("/") : [];
  if (
    typeof value !== "string"
    || value.length === 0
    || /^[A-Za-z]:/u.test(value)
    || value.startsWith("/")
    || value.includes("\\")
    || value.includes("\0")
    || (
      value !== "."
      && segments.some((segment) => (
        segment === ""
        || segment === "."
        || segment === ".."
      ))
    )
  ) {
    throw new Error("artifact root must be a portable relative path");
  }

  const manifestRoot = await realpath(dirname(manifestPath));
  const requestedRoot = resolve(manifestRoot, ...value.split("/"));
  if (!pathAtOrWithin(manifestRoot, requestedRoot)) {
    throw new Error("artifact root escapes its manifest directory");
  }

  let info;
  let canonicalRoot;
  try {
    info = await lstat(requestedRoot);
    canonicalRoot = await realpath(requestedRoot);
  } catch (error) {
    throw new Error(`cannot resolve artifact root: ${error.message}`);
  }
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error("artifact root must be a real directory");
  }
  if (
    canonicalRoot !== requestedRoot
    || !pathAtOrWithin(manifestRoot, canonicalRoot)
  ) {
    throw new Error("artifact root resolves outside its manifest directory");
  }

  return canonicalRoot;
}

export async function resolveArtifactManifestPath(context, value) {
  const requestedPath = resolveProjectPath(context, value, "artifact manifest");
  if (requestedPath.split(sep).at(-1) !== "drydock-artifact.json") {
    throw new Error("artifact manifest must be named drydock-artifact.json");
  }

  let artifactRoot;
  let canonicalPath;
  try {
    artifactRoot = await canonicalProjectArtifactRoot(context);
    canonicalPath = await realpath(requestedPath);
  } catch (error) {
    throw new Error(`cannot resolve artifact manifest: ${error.message}`);
  }

  if (!pathWithin(artifactRoot, canonicalPath)) {
    throw new Error("artifact manifest must resolve below project artifacts");
  }

  return canonicalPath;
}

export async function prepareArtifactOutputDirectory(context, value, label) {
  const requestedPath = resolveProjectPath(context, value, label);
  const artifactRoot = await canonicalProjectArtifactRoot(context);
  if (!pathWithin(artifactRoot, requestedPath)) {
    throw new Error(`${label} must be below project artifacts`);
  }

  let current = artifactRoot;
  const segments = relative(artifactRoot, requestedPath).split(sep);
  for (const segment of segments) {
    current = resolve(current, segment);
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink()) {
        throw new Error(`${label} path must not contain symbolic links`);
      }
      if (!info.isDirectory()) {
        throw new Error(`${label} parent is not a directory`);
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      await mkdir(current);
    }

    const canonicalCurrent = await realpath(current);
    if (!pathAtOrWithin(artifactRoot, canonicalCurrent)) {
      throw new Error(`${label} resolves outside project artifacts`);
    }
  }

  const canonicalRequestedPath = await realpath(requestedPath);
  if (
    canonicalRequestedPath !== requestedPath
    || !pathWithin(artifactRoot, canonicalRequestedPath)
  ) {
    throw new Error(`${label} resolves outside project artifacts`);
  }

  if ((await readdir(requestedPath)).length > 0) {
    throw new Error(`${label} directory must be empty`);
  }

  return requestedPath;
}

async function canonicalProjectArtifactRoot(context) {
  const info = await lstat(context.artifactRoot);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error("project artifact root must be a real directory");
  }

  const canonicalRoot = await realpath(context.artifactRoot);
  if (
    canonicalRoot !== context.artifactRoot
    || !pathWithin(context.projectRoot, canonicalRoot)
  ) {
    throw new Error("project artifact root resolves outside the project");
  }
  return canonicalRoot;
}

async function listArtifactPaths(root, manifestPath, current = root) {
  const entries = await readdir(current, {
    withFileTypes: true
  });
  const paths = new Set();

  for (const entry of entries) {
    const path = resolve(current, entry.name);
    const portablePath = portableRelative(root, path);

    if (entry.isSymbolicLink()) {
      throw new Error(`artifact tree must not contain symbolic links: ${portablePath}`);
    }
    if (entry.isDirectory()) {
      for (const nested of await listArtifactPaths(root, manifestPath, path)) {
        paths.add(nested);
      }
    } else if (entry.isFile()) {
      if (path !== manifestPath) {
        paths.add(portablePath);
      }
    } else {
      throw new Error(`artifact tree contains a non-regular entry: ${portablePath}`);
    }
  }

  return paths;
}

async function assertRegularArtifactFile(root, path, portablePath) {
  const info = await lstat(path);
  if (info.isSymbolicLink() || !info.isFile()) {
    throw new Error(`artifact checksum path is not a regular file: ${portablePath}`);
  }

  const canonicalPath = await realpath(path);
  if (!pathWithin(root, canonicalPath) || canonicalPath !== path) {
    throw new Error(`artifact checksum path escapes manifest root: ${portablePath}`);
  }
}

async function verifyReleaseHarness(verified) {
  const { context } = verified.project;
  const expectedRoot = resolve(context.projectRoot, "drydock");
  let canonicalExpectedRoot;
  try {
    canonicalExpectedRoot = await realpath(expectedRoot);
  } catch {
    throw new Error(
      "release builds require Drydock at the project drydock/ gitlink"
    );
  }

  if (canonicalExpectedRoot !== context.harnessRoot) {
    throw new Error(
      "release builds require Drydock at the project drydock/ gitlink"
    );
  }

  const staged = await git(
    context.projectRoot,
    "ls-files",
    "--stage",
    "--",
    "drydock"
  );
  const match = /^160000 ([a-f0-9]{40,64}) 0\tdrydock$/m.exec(staged);
  if (!match) {
    throw new Error("release builds require an exact drydock/ gitlink");
  }

  const harnessCommit = await git(context.harnessRoot, "rev-parse", "HEAD");
  if (harnessCommit !== match[1]) {
    throw new Error("Drydock checkout does not match the project gitlink");
  }

  const status = await git(
    context.harnessRoot,
    "status",
    "--porcelain",
    "--untracked-files=normal"
  );
  if (status) {
    throw new Error("Drydock checkout has local changes");
  }

  await verifyReachableHarness(context.harnessRoot, harnessCommit);
}

async function verifyReachableHarness(root, commit) {
  const remote = await optionalGit(root, "remote", "get-url", "origin");
  if (!remote) {
    throw new Error("Drydock checkout has no origin remote");
  }

  const namespace = (
    `refs/drydock-artifact-verify/${process.pid}-${verificationSequence += 1}`
  );
  try {
    await git(
      root,
      "fetch",
      "--quiet",
      "--no-tags",
      "origin",
      `+refs/heads/*:${namespace}/heads/*`,
      `+refs/tags/*:${namespace}/tags/*`
    );
    const refs = await git(
      root,
      "for-each-ref",
      "--format=%(refname)",
      `--contains=${commit}`,
      namespace
    );
    if (!refs) {
      throw new Error(`Drydock commit ${commit} is not reachable from origin`);
    }
  } finally {
    await deleteVerificationRefs(root, namespace);
  }
}

async function deleteVerificationRefs(root, namespace) {
  const refs = await optionalGit(
    root,
    "for-each-ref",
    "--format=%(refname)",
    namespace
  );
  for (const ref of refs?.split("\n").filter(Boolean) ?? []) {
    await optionalGit(root, "update-ref", "-d", ref);
  }
}

function componentProvenance(verified) {
  return Object.fromEntries(
    Object.entries(verified.components).map(([name, component]) => [
      name,
      {
        commit: (
          component.revision === "gitlink"
            ? component.commit
            : verified.projectRevision.commit
        ),
        path: component.path,
        revision: component.revision
      }
    ])
  );
}

async function exactTag(root, commit) {
  const tags = await optionalGit(
    root,
    "tag",
    "--points-at",
    commit
  );
  return tags
    ?.split("\n")
    .filter(Boolean)
    .sort()[0] ?? null;
}

async function optionalGit(root, ...args) {
  try {
    return await git(root, ...args);
  } catch {
    return null;
  }
}

async function git(root, ...args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd: root,
    encoding: "utf8"
  });
  return stdout.trim();
}

async function sha256File(path) {
  return sha256(await readFile(path));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function pathWithin(root, candidate) {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot !== ""
    && pathFromRoot !== ".."
    && !pathFromRoot.startsWith(`..${sep}`)
    && !isAbsolute(pathFromRoot)
  );
}

function pathAtOrWithin(root, candidate) {
  return candidate === root || pathWithin(root, candidate);
}

function portableRelative(root, target) {
  return relative(root, target).split(sep).join("/");
}
