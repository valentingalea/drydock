import { execFile } from "node:child_process";
import {
  lstat,
  readdir,
  realpath,
  stat
} from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const VALIDATION_PROFILES = new Set([
  "development",
  "release"
]);
let verificationSequence = 0;

export class ComponentValidationError extends Error {
  constructor(issues) {
    const normalized = Array.isArray(issues) ? issues : [issues];
    super(`invalid Drydock component state:\n${normalized.map((issue) => `- ${issue}`).join("\n")}`);
    this.name = "ComponentValidationError";
    this.issues = normalized;
  }
}

export async function verifyProjectComponents(project, options = {}) {
  const profile = options.profile ?? "development";
  if (!VALIDATION_PROFILES.has(profile)) {
    throw new ComponentValidationError(`unknown validation profile: ${profile}`);
  }

  const { context, descriptor } = project;
  const issues = [];
  const projectRepository = await inspectProjectRepository(context.projectRoot, issues);
  const components = {};

  for (const [name, declaration] of Object.entries(descriptor.components)) {
    const component = await resolveComponentRoot(
      name,
      declaration,
      context.projectRoot,
      issues
    );
    if (component) {
      components[name] = component;
    }
  }

  assertCanonicalComponentSeparation(components, issues);

  if (projectRepository) {
    for (const component of Object.values(components)) {
      if (component.revision === "project") {
        await verifyProjectOwnedComponent(component, projectRepository, issues);
      } else {
        await verifyGitlinkComponent(component, projectRepository, issues);
      }
    }

    if (profile === "release") {
      await verifyTrackedRuntimeInputs(
        descriptor.runtime.entries,
        components,
        projectRepository,
        issues
      );
      await verifyCleanRepository(
        projectRepository.root,
        "project repository",
        issues
      );
      await verifyReachableCommit(
        projectRepository.root,
        projectRepository.commit,
        "project repository",
        issues
      );

      for (const component of Object.values(components)) {
        if (component.revision !== "gitlink" || !component.commit) {
          continue;
        }

        await verifyCleanRepository(
          component.root,
          `gitlink component ${component.name}`,
          issues
        );
        await verifyReachableCommit(
          component.root,
          component.commit,
          `gitlink component ${component.name}`,
          issues
        );
      }
    }
  }

  if (issues.length > 0) {
    throw new ComponentValidationError(issues);
  }

  for (const component of Object.values(components)) {
    Object.freeze(component);
  }

  return Object.freeze({
    components: Object.freeze(components),
    profile,
    project,
    projectRevision: Object.freeze({
      commit: projectRepository.commit,
      root: projectRepository.root
    })
  });
}

async function inspectProjectRepository(projectRoot, issues) {
  let topLevel;
  let commit;

  try {
    topLevel = await git(projectRoot, "rev-parse", "--show-toplevel");
    commit = await git(projectRoot, "rev-parse", "HEAD");
  } catch (error) {
    issues.push(`project root is not a committed Git repository: ${gitMessage(error)}`);
    return null;
  }

  const canonicalTopLevel = await realpath(topLevel);
  if (canonicalTopLevel !== projectRoot) {
    issues.push(
      `project descriptor must belong to the repository root: ${projectRoot}`
    );
    return null;
  }

  return {
    commit,
    root: canonicalTopLevel
  };
}

async function resolveComponentRoot(name, declaration, projectRoot, issues) {
  const requestedRoot = resolve(projectRoot, declaration.path);
  if (!pathWithin(projectRoot, requestedRoot) || requestedRoot === projectRoot) {
    issues.push(`component ${name} escapes or aliases the project root: ${declaration.path}`);
    return null;
  }

  let componentStat;
  try {
    componentStat = await lstat(requestedRoot);
  } catch (error) {
    if (error?.code === "ENOENT") {
      issues.push(`component ${name} is missing: ${declaration.path}`);
      return null;
    }
    throw error;
  }

  if (componentStat.isSymbolicLink()) {
    issues.push(`component ${name} root must not be a symbolic link: ${declaration.path}`);
    return null;
  }

  if (!componentStat.isDirectory()) {
    issues.push(`component ${name} root is not a directory: ${declaration.path}`);
    return null;
  }

  const canonicalRoot = await realpath(requestedRoot);
  if (!pathWithin(projectRoot, canonicalRoot)) {
    issues.push(`component ${name} resolves outside the project root: ${declaration.path}`);
    return null;
  }

  if (canonicalRoot !== requestedRoot) {
    issues.push(`component ${name} path resolves through a symbolic link: ${declaration.path}`);
    return null;
  }

  return {
    commit: null,
    name,
    path: declaration.path,
    revision: declaration.revision,
    root: canonicalRoot
  };
}

function assertCanonicalComponentSeparation(components, issues) {
  const values = Object.values(components);
  for (let left = 0; left < values.length; left += 1) {
    for (let right = left + 1; right < values.length; right += 1) {
      if (pathsOverlap(values[left].root, values[right].root)) {
        issues.push(
          `canonical component roots overlap: ${values[left].name} and ${values[right].name}`
        );
      }
    }
  }
}

async function verifyProjectOwnedComponent(component, projectRepository, issues) {
  let topLevel;
  try {
    topLevel = await git(component.root, "rev-parse", "--show-toplevel");
  } catch (error) {
    issues.push(
      `project component ${component.name} is not owned by the enclosing repository: ${gitMessage(error)}`
    );
    return;
  }

  if (await realpath(topLevel) !== projectRepository.root) {
    issues.push(
      `project component ${component.name} belongs to a different Git repository`
    );
    return;
  }

  const trackedFiles = await git(
    projectRepository.root,
    "ls-files",
    "--",
    literalPathspec(component.path)
  );
  if (!trackedFiles) {
    issues.push(`project component ${component.name} has no tracked files`);
  }
}

async function verifyGitlinkComponent(component, projectRepository, issues) {
  const staged = await gitRaw(
    projectRepository.root,
    "ls-files",
    "-z",
    "--stage",
    "--",
    literalPathspec(component.path)
  );
  const gitlink = staged
    .split("\0")
    .filter(Boolean)
    .map(parseStagedEntry)
    .find((entry) => entry.path === component.path && entry.mode === "160000");

  if (!gitlink) {
    issues.push(
      `gitlink component ${component.name} is not an exact submodule entry: ${component.path}`
    );
    return;
  }

  let topLevel;
  let checkoutCommit;
  try {
    topLevel = await git(component.root, "rev-parse", "--show-toplevel");
    checkoutCommit = await git(component.root, "rev-parse", "HEAD");
  } catch (error) {
    issues.push(
      `gitlink component ${component.name} is not an initialized Git checkout: ${gitMessage(error)}`
    );
    return;
  }

  if (await realpath(topLevel) !== component.root) {
    issues.push(`gitlink component ${component.name} checkout root is invalid`);
  }

  if (checkoutCommit !== gitlink.commit) {
    issues.push(
      `gitlink component ${component.name} checkout ${checkoutCommit} does not match pin ${gitlink.commit}`
    );
  }

  component.commit = checkoutCommit;
}

async function verifyCleanRepository(root, label, issues) {
  const status = await git(
    root,
    "status",
    "--porcelain",
    "--untracked-files=normal",
    "--ignore-submodules=none"
  );
  if (status) {
    issues.push(`${label} has local changes`);
  }
}

async function verifyTrackedRuntimeInputs(
  entries,
  components,
  projectRepository,
  issues
) {
  const trackedFilesByRoot = new Map();

  for (const entry of entries) {
    const component = components[entry.component];
    if (!component) {
      continue;
    }

    const repositoryRoot = component.revision === "project"
      ? projectRepository.root
      : component.root;
    let trackedFiles = trackedFilesByRoot.get(repositoryRoot);
    if (!trackedFiles) {
      trackedFiles = new Set(
        (await gitRaw(repositoryRoot, "ls-files", "-z", "--cached"))
          .split("\0")
          .filter(Boolean)
      );
      trackedFilesByRoot.set(repositoryRoot, trackedFiles);
    }

    const requestedSource = resolve(component.root, entry.source);
    const sourceFiles = await collectRuntimeInputFiles(
      requestedSource,
      component.root
    );
    const untracked = [];

    for (const sourceFile of sourceFiles) {
      const repositoryPath = relative(repositoryRoot, sourceFile)
        .split(sep)
        .join("/");
      if (!trackedFiles.has(repositoryPath)) {
        untracked.push(repositoryPath);
      }
    }

    if (untracked.length > 0) {
      untracked.sort();
      const declaredPath = `${component.path}/${entry.source}`;
      issues.push(
        `release runtime source has untracked content: ${declaredPath} `
        + `(${untracked.join(", ")})`
      );
    }
  }
}

async function collectRuntimeInputFiles(requestedPath, ownerRoot, ancestors = new Set()) {
  let requestedInfo;
  let canonicalPath;
  try {
    requestedInfo = await lstat(requestedPath);
    canonicalPath = await realpath(requestedPath);
  } catch {
    // Composition reports missing, broken, and cyclic inputs with its richer context.
    return new Set();
  }

  if (!pathWithin(ownerRoot, canonicalPath)) {
    return new Set();
  }

  const files = new Set();
  if (requestedInfo.isSymbolicLink()) {
    files.add(requestedPath);
  }

  const canonicalInfo = requestedInfo.isSymbolicLink()
    ? await stat(canonicalPath)
    : requestedInfo;
  if (canonicalInfo.isFile()) {
    files.add(canonicalPath);
    return files;
  }
  if (!canonicalInfo.isDirectory() || ancestors.has(canonicalPath)) {
    return files;
  }

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(canonicalPath);
  for (const entry of await readdir(canonicalPath)) {
    const childFiles = await collectRuntimeInputFiles(
      resolve(canonicalPath, entry),
      ownerRoot,
      nextAncestors
    );
    for (const childFile of childFiles) {
      files.add(childFile);
    }
  }
  return files;
}

async function verifyReachableCommit(root, commit, label, issues) {
  let remote;
  try {
    remote = await git(root, "remote", "get-url", "origin");
  } catch {
    issues.push(`${label} has no origin remote`);
    return;
  }

  if (!remote) {
    issues.push(`${label} has no origin remote`);
    return;
  }

  const namespace = `refs/drydock-verify/${process.pid}-${verificationSequence += 1}`;
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
    const containingRefs = await git(
      root,
      "for-each-ref",
      "--format=%(refname)",
      `--contains=${commit}`,
      namespace
    );
    if (!containingRefs) {
      issues.push(`${label} commit ${commit} is not reachable from origin`);
    }
  } catch (error) {
    issues.push(`${label} origin reachability check failed: ${gitMessage(error)}`);
  } finally {
    await deleteVerificationRefs(root, namespace);
  }
}

async function deleteVerificationRefs(root, namespace) {
  let refs;
  try {
    refs = await git(root, "for-each-ref", "--format=%(refname)", namespace);
  } catch {
    return;
  }

  for (const ref of refs.split("\n").filter(Boolean)) {
    try {
      await git(root, "update-ref", "-d", ref);
    } catch {
      // A failed cleanup should not hide the original validation result.
    }
  }
}

function parseStagedEntry(line) {
  const [metadata, path = ""] = line.split("\t", 2);
  const [mode, commit] = metadata.split(" ");
  return {
    commit,
    mode,
    path
  };
}

async function git(cwd, ...args) {
  return (await gitRaw(cwd, ...args)).trim();
}

async function gitRaw(cwd, ...args) {
  const { stdout } = await execFileAsync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024
  });
  return stdout;
}

function gitMessage(error) {
  return String(error?.stderr || error?.message || error).trim();
}

function literalPathspec(path) {
  return `:(top,literal)${path}`;
}

function pathWithin(root, candidate) {
  const pathFromRoot = relative(root, candidate);
  return (
    pathFromRoot === ""
    || (
      pathFromRoot !== ".."
      && !pathFromRoot.startsWith(`..${sep}`)
      && !isAbsolute(pathFromRoot)
    )
  );
}

function pathsOverlap(left, right) {
  return (
    left === right
    || left.startsWith(`${right}${sep}`)
    || right.startsWith(`${left}${sep}`)
  );
}
