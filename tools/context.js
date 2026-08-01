import { realpath } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const PROJECT_DIRECTORY = "shipping";
const PROJECT_FILENAME = "drydock-project.json";

export const harnessRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export class CliUsageError extends Error {
  constructor(message) {
    super(message);
    this.name = "CliUsageError";
  }
}

export async function resolveProjectContext(
  projectArgument,
  {
    invocationCwd,
    selectedHarnessRoot = harnessRoot
  } = {}
) {
  if (!projectArgument) {
    throw new CliUsageError("--project is required");
  }

  if (!invocationCwd) {
    throw new TypeError("invocationCwd is required");
  }

  const requestedPath = isAbsolute(projectArgument)
    ? resolve(projectArgument)
    : resolve(invocationCwd, projectArgument);

  if (
    requestedPath.split(sep).at(-1) !== PROJECT_FILENAME
    || requestedPath.split(sep).at(-2) !== PROJECT_DIRECTORY
  ) {
    throw new CliUsageError(
      `project descriptor must be ${PROJECT_DIRECTORY}/${PROJECT_FILENAME}`
    );
  }

  let projectPath;
  try {
    projectPath = await realpath(requestedPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new CliUsageError(`project descriptor does not exist: ${projectArgument}`);
    }
    throw error;
  }

  const shippingRoot = dirname(projectPath);
  const projectRoot = dirname(shippingRoot);

  if (
    projectPath !== resolve(shippingRoot, PROJECT_FILENAME)
    || shippingRoot !== resolve(projectRoot, PROJECT_DIRECTORY)
  ) {
    throw new CliUsageError(
      `project descriptor must resolve to ${PROJECT_DIRECTORY}/${PROJECT_FILENAME}`
    );
  }

  return {
    artifactRoot: resolve(projectRoot, "artifacts"),
    harnessRoot: resolve(selectedHarnessRoot),
    projectPath,
    projectRoot,
    shippingRoot
  };
}

export function resolveProjectPath(context, value, label = "project path") {
  if (typeof value !== "string" || value.length === 0 || isAbsolute(value)) {
    throw new CliUsageError(`${label} must be a non-empty project-relative path`);
  }

  const absolute = resolve(context.projectRoot, value);
  const pathFromProject = relative(context.projectRoot, absolute);

  if (
    pathFromProject === ".."
    || pathFromProject.startsWith(`..${sep}`)
    || isAbsolute(pathFromProject)
  ) {
    throw new CliUsageError(`${label} escapes the project root: ${value}`);
  }

  return absolute;
}

export function isDirectInvocation(moduleUrl, argvEntry) {
  if (!argvEntry) {
    return false;
  }

  return moduleUrl === pathToFileURL(resolve(argvEntry)).href;
}
