import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  readFile,
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

  if (projectRemote) {
    project.remote = projectRemote;
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

  for (const checksum of manifest.checksums) {
    const filePath = resolve(
      manifestRoot,
      ...checksum.path.split("/")
    );
    if (!pathWithin(manifestRoot, filePath)) {
      throw new Error(`artifact checksum path escapes manifest root: ${checksum.path}`);
    }

    let contents;
    try {
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

function portableRelative(root, target) {
  return relative(root, target).split(sep).join("/");
}
