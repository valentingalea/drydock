import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  stat,
  writeFile
} from "node:fs/promises";
import {
  dirname,
  isAbsolute,
  posix,
  relative,
  resolve,
  sep
} from "node:path";
import { projectRuntimeSourcePolicy } from "./project.js";

const RESERVED_RUNTIME_ENTRIES = [
  {
    source: "runtime/web/host-bridge.js",
    target: "host-bridge.js"
  },
  {
    source: "runtime/web/vendor/drydock-host-bridge",
    target: "vendor/drydock-host-bridge"
  }
];
const RESTRICTED_DIRECTORY_NAMES = new Set([
  ".git",
  "artifacts",
  "docs",
  "secrets",
  "test",
  "tests"
]);

export class CompositionError extends Error {
  constructor(message) {
    super(message);
    this.name = "CompositionError";
  }
}

export async function createRuntimeComposition(verifiedProject) {
  const baseEntries = [];
  const overlayEntries = [];

  for (const declaration of RESERVED_RUNTIME_ENTRIES) {
    baseEntries.push(await createMapping({
      declaration,
      owner: "drydock",
      ownerRoot: verifiedProject.project.context.harnessRoot,
      overlay: false,
      reserved: true
    }));
  }

  for (const declaration of verifiedProject.project.descriptor.runtime.entries) {
    const component = verifiedProject.components[declaration.component];
    const sourcePolicy = projectRuntimeSourcePolicy(
      component.path,
      declaration.source
    );
    const mapping = await createMapping({
      declaration,
      owner: declaration.component,
      ownerRoot: component.root,
      overlay: declaration.overlay === true,
      reserved: false
    });

    if (
      sourcePolicy.shipping
      && mapping.kind !== "file"
    ) {
      throw new CompositionError(
        `shipping integration must be an explicit file: ${sourcePolicy.path}`
      );
    }
    if (sourcePolicy.shipping && !mapping.overlay) {
      throw new CompositionError(
        `shipping integration must be an overlay: ${sourcePolicy.path}`
      );
    }

    if (mapping.overlay) {
      overlayEntries.push(mapping);
    } else {
      baseEntries.push(mapping);
    }
  }

  const effectiveTargetKinds = new Map();
  for (const base of baseEntries) {
    applyTargetKinds(effectiveTargetKinds, base);
  }

  for (const overlay of overlayEntries) {
    const base = baseEntries.find((entry) => (
      overlay.target === entry.target
      || overlay.target.startsWith(`${entry.target}/`)
    ));
    const requestedBasePath = base
      ? sourcePathForRequest(base, overlay.target)
      : null;

    if (!base || !requestedBasePath) {
      throw new CompositionError(
        `runtime overlay target has no base source: ${overlay.target}`
      );
    }

    const baseSource = await inspectSafeSource(
      base.owner,
      base.ownerRoot,
      requestedBasePath,
      base.source
    );
    if (baseSource.kind !== overlay.kind) {
      throw new CompositionError(
        `runtime overlay changes target type at ${overlay.target}: `
        + `${baseSource.kind} to ${overlay.kind}`
      );
    }

    assertCompatibleTargetKinds(effectiveTargetKinds, overlay);
    applyTargetKinds(effectiveTargetKinds, overlay);
  }

  const lookupEntries = [
    ...[...overlayEntries].reverse(),
    ...[...baseEntries].reverse()
  ];

  const composition = {
    artifactRoot: verifiedProject.project.context.artifactRoot,
    baseEntries: Object.freeze(baseEntries),
    entrypoint: verifiedProject.project.descriptor.runtime.entrypoint,
    lookupEntries: Object.freeze(lookupEntries),
    overlayEntries: Object.freeze(overlayEntries),
    projectRoot: verifiedProject.project.context.projectRoot
  };
  const entrypoint = await readRuntimeFile(
    composition,
    "/"
  );
  if (!entrypoint) {
    throw new CompositionError(
      `runtime entrypoint is not a composed file: ${composition.entrypoint}`
    );
  }

  return Object.freeze(composition);
}

export async function readRuntimeFile(composition, pathname) {
  const file = await openRuntimeFile(composition, pathname);
  if (!file) {
    return null;
  }

  try {
    return Object.freeze({
      contents: await file.handle.readFile(),
      owner: file.owner,
      sourcePath: file.sourcePath,
      target: file.target
    });
  } finally {
    await file.handle.close();
  }
}

export async function openRuntimeFile(composition, pathname) {
  const request = normalizeRuntimeRequest(pathname, composition.entrypoint);
  if (!request) {
    throw new CompositionError(`unsafe runtime request: ${pathname}`);
  }

  for (const mapping of composition.lookupEntries) {
    const sourcePath = sourcePathForRequest(mapping, request);
    if (!sourcePath) {
      continue;
    }

    const file = await openSafeSourceFile(mapping, sourcePath);
    if (!file) {
      continue;
    }

    return Object.freeze({
      handle: file.handle,
      owner: mapping.owner,
      size: file.size,
      sourcePath: file.sourcePath,
      target: request
    });
  }

  return null;
}

export async function stageRuntime(composition, outDir) {
  const canonicalArtifactRoot = await prepareArtifactRoot(
    composition.artifactRoot,
    composition
  );
  const requestedOutDir = resolve(outDir);

  if (
    requestedOutDir === canonicalArtifactRoot
    || !pathWithin(canonicalArtifactRoot, requestedOutDir)
  ) {
    throw new CompositionError("stage output must be below the project artifact root");
  }

  await assertSafeOutputPath(requestedOutDir, canonicalArtifactRoot);
  await mkdir(requestedOutDir, {
    recursive: true
  });

  const existing = await readdir(requestedOutDir);
  if (existing.length > 0) {
    throw new CompositionError("stage output directory must be empty");
  }

  for (const mapping of composition.baseEntries) {
    await stageMapping(mapping, requestedOutDir);
  }
  for (const mapping of composition.overlayEntries) {
    await stageMapping(mapping, requestedOutDir);
  }

  return requestedOutDir;
}

async function createMapping({
  declaration,
  owner,
  ownerRoot,
  overlay,
  reserved
}) {
  const requestedSourcePath = resolve(ownerRoot, declaration.source);
  if (!pathWithin(ownerRoot, requestedSourcePath)) {
    throw new CompositionError(
      `runtime source escapes ${owner}: ${declaration.source}`
    );
  }

  const source = await inspectSafeSource(
    owner,
    ownerRoot,
    requestedSourcePath,
    declaration.source
  );

  return Object.freeze({
    kind: source.kind,
    overlay,
    owner,
    ownerRoot,
    requestedSourcePath,
    reserved,
    source: declaration.source,
    sourceKinds: source.sourceKinds,
    target: declaration.target
  });
}

async function inspectSafeSource(owner, ownerRoot, requestedPath, displayPath) {
  let requestedStat;
  try {
    requestedStat = await lstat(requestedPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new CompositionError(`runtime source is missing in ${owner}: ${displayPath}`);
    }
    throw error;
  }

  let canonicalPath;
  try {
    canonicalPath = await realpath(requestedPath);
  } catch (error) {
    throw new CompositionError(
      `runtime source cannot be resolved in ${owner}: ${displayPath}: ${error.message}`
    );
  }

  if (!pathWithin(ownerRoot, canonicalPath)) {
    throw new CompositionError(
      `runtime source resolves outside ${owner}: ${displayPath}`
    );
  }

  assertUnrestrictedSource(owner, ownerRoot, canonicalPath, displayPath);

  const canonicalStat = requestedStat.isSymbolicLink()
    ? await stat(canonicalPath)
    : requestedStat;

  if (canonicalStat.isFile()) {
    return {
      canonicalPath,
      kind: "file",
      sourceKinds: Object.freeze([
        Object.freeze({
          kind: "file",
          path: ""
        })
      ])
    };
  }

  if (canonicalStat.isDirectory()) {
    const sourceKinds = await inspectSafeDirectoryTree(
      owner,
      ownerRoot,
      requestedPath,
      displayPath,
      new Set()
    );
    return {
      canonicalPath,
      kind: "directory",
      sourceKinds: Object.freeze(sourceKinds.map(Object.freeze))
    };
  }

  throw new CompositionError(
    `runtime source is not a file or directory in ${owner}: ${displayPath}`
  );
}

async function inspectSafeDirectoryTree(
  owner,
  ownerRoot,
  requestedDir,
  displayPath,
  ancestors
) {
  let canonicalDir;
  try {
    canonicalDir = await realpath(requestedDir);
  } catch (error) {
    throw new CompositionError(
      `runtime directory cannot be resolved in ${owner}: ${displayPath}: ${error.message}`
    );
  }

  if (!pathWithin(ownerRoot, canonicalDir)) {
    throw new CompositionError(
      `runtime directory escapes ${owner}: ${displayPath}`
    );
  }
  assertUnrestrictedSource(owner, ownerRoot, canonicalDir, displayPath);

  if (ancestors.has(canonicalDir)) {
    throw new CompositionError(
      `runtime directory contains a symbolic-link cycle in ${owner}: ${displayPath}`
    );
  }

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(canonicalDir);
  const sourceKinds = [{
    kind: "directory",
    path: ""
  }];

  for (const entry of await readdir(canonicalDir, {
    withFileTypes: true
  })) {
    const requestedChild = resolve(canonicalDir, entry.name);
    let canonicalChild;
    try {
      canonicalChild = await realpath(requestedChild);
    } catch (error) {
      throw new CompositionError(
        `runtime entry cannot be resolved in ${owner}: `
        + `${displayPath}/${entry.name}: ${error.message}`
      );
    }

    if (!pathWithin(ownerRoot, canonicalChild)) {
      throw new CompositionError(
        `runtime directory entry escapes ${owner}: ${displayPath}/${entry.name}`
      );
    }
    assertUnrestrictedSource(
      owner,
      ownerRoot,
      canonicalChild,
      `${displayPath}/${entry.name}`
    );

    const childStat = await stat(canonicalChild);
    if (childStat.isDirectory()) {
      const childKinds = await inspectSafeDirectoryTree(
        owner,
        ownerRoot,
        requestedChild,
        `${displayPath}/${entry.name}`,
        nextAncestors
      );
      for (const childKind of childKinds) {
        sourceKinds.push({
          kind: childKind.kind,
          path: childKind.path
            ? posix.join(entry.name, childKind.path)
            : entry.name
        });
      }
    } else if (!childStat.isFile()) {
      throw new CompositionError(
        `runtime directory entry is not a file or directory: `
        + `${displayPath}/${entry.name}`
      );
    } else {
      sourceKinds.push({
        kind: "file",
        path: entry.name
      });
    }
  }

  return sourceKinds;
}

function assertCompatibleTargetKinds(effectiveTargetKinds, mapping) {
  for (const sourceKind of mapping.sourceKinds) {
    const target = sourceKind.path
      ? posix.join(mapping.target, sourceKind.path)
      : mapping.target;
    const effectiveKind = effectiveTargetKinds.get(target);

    if (effectiveKind && effectiveKind !== sourceKind.kind) {
      throw new CompositionError(
        `runtime overlay changes target type at ${target}: `
        + `${effectiveKind} to ${sourceKind.kind}`
      );
    }
  }
}

function applyTargetKinds(effectiveTargetKinds, mapping) {
  for (const sourceKind of mapping.sourceKinds) {
    const target = sourceKind.path
      ? posix.join(mapping.target, sourceKind.path)
      : mapping.target;
    effectiveTargetKinds.set(target, sourceKind.kind);
  }
}

function normalizeRuntimeRequest(pathname, entrypoint) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  if (decoded.includes("\\") || decoded.includes("\0")) {
    return null;
  }

  const requested = decoded === "/" ? `/${entrypoint}` : decoded;
  if (requested.split("/").some((segment) => segment === "." || segment === "..")) {
    return null;
  }

  const withIndex = requested.endsWith("/") ? `${requested}index.html` : requested;
  const normalized = posix.normalize(withIndex).replace(/^\/+/, "");

  if (
    normalized === ""
    || normalized === "."
    || normalized === ".."
    || normalized.startsWith("../")
    || normalized.split("/").includes("..")
  ) {
    return null;
  }

  return normalized;
}

function sourcePathForRequest(mapping, request) {
  if (mapping.kind === "file") {
    return request === mapping.target
      ? mapping.requestedSourcePath
      : null;
  }

  if (request === mapping.target) {
    return mapping.requestedSourcePath;
  }

  if (!request.startsWith(`${mapping.target}/`)) {
    return null;
  }

  const suffix = request.slice(mapping.target.length + 1);
  const requestedPath = resolve(mapping.requestedSourcePath, ...suffix.split("/"));
  return pathWithin(mapping.requestedSourcePath, requestedPath)
    ? requestedPath
    : null;
}

async function openSafeSourceFile(mapping, requestedPath) {
  let canonicalPath;
  try {
    canonicalPath = await realpath(requestedPath);
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      let requestedStat = null;
      try {
        requestedStat = await lstat(requestedPath);
      } catch (lstatError) {
        if (lstatError?.code !== "ENOENT" && lstatError?.code !== "ENOTDIR") {
          throw lstatError;
        }
      }

      if (requestedStat?.isSymbolicLink()) {
        throw new CompositionError(
          `runtime source link cannot be resolved in ${mapping.owner}: ${mapping.source}`
        );
      }
      if (requestedPath === mapping.requestedSourcePath) {
        throw new CompositionError(
          `runtime source is missing in ${mapping.owner}: ${mapping.source}`
        );
      }
      return null;
    }
    throw error;
  }

  if (!pathWithin(mapping.ownerRoot, canonicalPath)) {
    throw new CompositionError(
      `runtime read escapes ${mapping.owner}: ${mapping.source}`
    );
  }

  assertUnrestrictedSource(
    mapping.owner,
    mapping.ownerRoot,
    canonicalPath,
    mapping.source
  );

  const sourceStat = await stat(canonicalPath);
  if (!sourceStat.isFile()) {
    return null;
  }

  const handle = await open(canonicalPath, "r");
  try {
    const handleStat = await handle.stat();
    if (!handleStat.isFile()) {
      await handle.close();
      return null;
    }

    return {
      handle,
      size: handleStat.size,
      sourcePath: canonicalPath
    };
  } catch (error) {
    await handle.close();
    throw error;
  }
}

async function prepareArtifactRoot(artifactRoot, composition) {
  if (!pathWithin(composition.projectRoot, artifactRoot)) {
    throw new CompositionError("artifact root must be inside the project root");
  }

  try {
    const artifactStat = await lstat(artifactRoot);
    if (artifactStat.isSymbolicLink()) {
      throw new CompositionError("artifact root must not be a symbolic link");
    }
    if (!artifactStat.isDirectory()) {
      throw new CompositionError("artifact root must be a directory");
    }
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  await mkdir(artifactRoot, {
    recursive: true
  });
  const canonicalArtifactRoot = await realpath(artifactRoot);
  if (
    canonicalArtifactRoot !== artifactRoot
    || !pathWithin(composition.projectRoot, canonicalArtifactRoot)
  ) {
    throw new CompositionError("artifact root resolves outside the project root");
  }

  for (const mapping of [
    ...composition.baseEntries,
    ...composition.overlayEntries
  ]) {
    if (pathsOverlap(canonicalArtifactRoot, mapping.ownerRoot)) {
      throw new CompositionError(
        `artifact root overlaps runtime owner ${mapping.owner}`
      );
    }
  }

  return canonicalArtifactRoot;
}

async function assertSafeOutputPath(outDir, artifactRoot) {
  let current = outDir;
  const missing = [];

  while (current !== artifactRoot) {
    try {
      const currentStat = await lstat(current);
      if (currentStat.isSymbolicLink()) {
        throw new CompositionError("stage output path must not contain symbolic links");
      }
      if (!currentStat.isDirectory()) {
        throw new CompositionError("stage output parent is not a directory");
      }
      break;
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
      missing.push(current);
      current = dirname(current);
    }
  }

  const canonicalParent = await realpath(current);
  if (!pathWithin(artifactRoot, canonicalParent)) {
    throw new CompositionError("stage output resolves outside the artifact root");
  }

  for (const path of missing.reverse()) {
    await mkdir(path);
  }
}

async function stageMapping(mapping, outDir) {
  if (mapping.kind === "file") {
    const file = await openSafeSourceFile(mapping, mapping.requestedSourcePath);
    if (!file) {
      throw new CompositionError(
        `runtime source is no longer a file in ${mapping.owner}: ${mapping.source}`
      );
    }
    const targetPath = resolveStageTarget(outDir, mapping.target);
    try {
      await mkdir(dirname(targetPath), {
        recursive: true
      });
      await writeFile(targetPath, await file.handle.readFile());
    } finally {
      await file.handle.close();
    }
    return;
  }

  await stageDirectory(
    mapping,
    mapping.requestedSourcePath,
    resolveStageTarget(outDir, mapping.target),
    new Set()
  );
}

async function stageDirectory(mapping, requestedDir, targetDir, ancestors) {
  let canonicalDir;
  try {
    canonicalDir = await realpath(requestedDir);
  } catch (error) {
    throw new CompositionError(
      `runtime directory cannot be resolved in ${mapping.owner}: ${mapping.source}: ${error.message}`
    );
  }

  if (!pathWithin(mapping.ownerRoot, canonicalDir)) {
    throw new CompositionError(
      `runtime directory escapes ${mapping.owner}: ${mapping.source}`
    );
  }

  const directoryStat = await stat(canonicalDir);
  if (!directoryStat.isDirectory()) {
    throw new CompositionError(
      `runtime source changed type in ${mapping.owner}: ${mapping.source}`
    );
  }

  if (ancestors.has(canonicalDir)) {
    throw new CompositionError(
      `runtime directory contains a symbolic-link cycle in ${mapping.owner}: ${mapping.source}`
    );
  }

  const nextAncestors = new Set(ancestors);
  nextAncestors.add(canonicalDir);
  await mkdir(targetDir, {
    recursive: true
  });

  for (const entry of await readdir(canonicalDir, {
    withFileTypes: true
  })) {
    const requestedChild = resolve(canonicalDir, entry.name);
    let canonicalChild;
    try {
      canonicalChild = await realpath(requestedChild);
    } catch (error) {
      throw new CompositionError(
        `runtime entry cannot be resolved in ${mapping.owner}: `
        + `${mapping.source}/${entry.name}: ${error.message}`
      );
    }
    if (!pathWithin(mapping.ownerRoot, canonicalChild)) {
      throw new CompositionError(
        `runtime directory entry escapes ${mapping.owner}: ${mapping.source}/${entry.name}`
      );
    }

    assertUnrestrictedSource(
      mapping.owner,
      mapping.ownerRoot,
      canonicalChild,
      `${mapping.source}/${entry.name}`
    );

    const childStat = await stat(canonicalChild);
    const targetChild = resolve(targetDir, entry.name);

    if (childStat.isDirectory()) {
      await stageDirectory(
        mapping,
        requestedChild,
        targetChild,
        nextAncestors
      );
    } else if (childStat.isFile()) {
      const contents = await readFile(canonicalChild);
      await mkdir(dirname(targetChild), {
        recursive: true
      });
      await writeFile(targetChild, contents);
    } else {
      throw new CompositionError(
        `runtime directory entry is not a file or directory: ${mapping.source}/${entry.name}`
      );
    }
  }
}

function assertUnrestrictedSource(owner, ownerRoot, canonicalPath, displayPath) {
  const sourceFromOwner = relative(ownerRoot, canonicalPath);
  if (
    sourceFromOwner
      .split(sep)
      .some((segment) => RESTRICTED_DIRECTORY_NAMES.has(segment.toLowerCase()))
  ) {
    throw new CompositionError(
      `runtime source selects a restricted path in ${owner}: ${displayPath}`
    );
  }
}

function resolveStageTarget(outDir, target) {
  const targetPath = resolve(outDir, ...target.split("/"));
  if (!pathWithin(outDir, targetPath)) {
    throw new CompositionError(`runtime target escapes stage output: ${target}`);
  }
  return targetPath;
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
