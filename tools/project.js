import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import {
  DEFAULT_CAPABILITIES,
  HOST_PROTOCOL_VERSION
} from "../contracts/host-bridge/src/index.js";

export const PROJECT_SCHEMA_VERSION = 1;
export const DRYDOCK_CONTRACT_VERSION = "1";

const RESERVED_COMPONENT_ROOTS = [
  ".git",
  "artifacts",
  "drydock"
];
const RESERVED_RUNTIME_TARGETS = [
  ".drydock-channel",
  ".git",
  "drydock-artifact.json",
  "host-bridge.js",
  "package.json",
  "shipping",
  "vendor/drydock-host-bridge"
];
const RESTRICTED_SOURCE_SEGMENTS = new Set([
  ".git",
  "artifacts",
  "docs",
  "secrets",
  "test",
  "tests"
]);
const validatorBySchemaPath = new Map();

export class ProjectValidationError extends Error {
  constructor(issues) {
    const normalized = Array.isArray(issues) ? issues : [issues];
    super(`invalid Drydock project:\n${normalized.map((issue) => `- ${issue}`).join("\n")}`);
    this.name = "ProjectValidationError";
    this.issues = normalized;
  }
}

export async function loadProject(context) {
  const descriptor = await readDescriptor(context.projectPath);
  const validate = await loadSchemaValidator(context.harnessRoot);

  if (!validate(descriptor)) {
    throw new ProjectValidationError(
      validate.errors.map(formatSchemaError)
    );
  }

  const issues = validateProjectSemantics(descriptor);
  if (issues.length > 0) {
    throw new ProjectValidationError(issues);
  }

  return Object.freeze({
    context,
    descriptor
  });
}

export function validateProjectSemantics(descriptor) {
  const issues = [];

  if (descriptor.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    issues.push(
      `unsupported project schema version ${descriptor.schemaVersion}; supported: ${PROJECT_SCHEMA_VERSION}`
    );
  }

  if (descriptor.drydockContract !== DRYDOCK_CONTRACT_VERSION) {
    issues.push(
      `unsupported Drydock contract ${descriptor.drydockContract}; supported: ${DRYDOCK_CONTRACT_VERSION}`
    );
  }

  if (descriptor.host.protocol !== HOST_PROTOCOL_VERSION) {
    issues.push(
      `unsupported host protocol ${descriptor.host.protocol}; supported: ${HOST_PROTOCOL_VERSION}`
    );
  }

  for (const capability of descriptor.host.requiredCapabilities) {
    if (!Object.hasOwn(DEFAULT_CAPABILITIES, capability)) {
      issues.push(`unknown required host capability: ${capability}`);
    }
  }

  const componentEntries = Object.entries(descriptor.components);
  for (const [name, component] of componentEntries) {
    const pathIssue = safeRelativePathIssue(component.path);
    if (pathIssue) {
      issues.push(`component ${name} path ${pathIssue}: ${component.path}`);
      continue;
    }

    if (RESERVED_COMPONENT_ROOTS.some((path) => pathsOverlap(component.path, path))) {
      issues.push(`component ${name} uses reserved root: ${component.path}`);
    }
  }

  for (let left = 0; left < componentEntries.length; left += 1) {
    for (let right = left + 1; right < componentEntries.length; right += 1) {
      const [leftName, leftComponent] = componentEntries[left];
      const [rightName, rightComponent] = componentEntries[right];
      if (pathsOverlap(leftComponent.path, rightComponent.path)) {
        issues.push(
          `component roots overlap: ${leftName} (${leftComponent.path}) and ${rightName} (${rightComponent.path})`
        );
      }
    }
  }

  const baseEntries = [];
  const overlays = [];

  for (const [index, entry] of descriptor.runtime.entries.entries()) {
    const label = `runtime entry ${index}`;
    if (!Object.hasOwn(descriptor.components, entry.component)) {
      issues.push(`${label} references unknown component: ${entry.component}`);
      continue;
    }

    const sourceIssue = safeRelativePathIssue(entry.source);
    if (sourceIssue) {
      issues.push(`${label} source ${sourceIssue}: ${entry.source}`);
    }

    const targetIssue = safeRelativePathIssue(entry.target);
    if (targetIssue) {
      issues.push(`${label} target ${targetIssue}: ${entry.target}`);
    }

    if (!sourceIssue) {
      const sourceSegments = entry.source.split("/");
      if (
        sourceSegments.some(
          (segment) => RESTRICTED_SOURCE_SEGMENTS.has(segment.toLowerCase())
        )
      ) {
        issues.push(`${label} selects restricted source: ${entry.source}`);
      }

      if (
        descriptor.components[entry.component].path === "shipping"
        && !entry.source.startsWith("integrations/")
      ) {
        issues.push(
          `${label} may select only explicit shipping integrations: ${entry.source}`
        );
      }
    }

    if (
      !targetIssue
      && RESERVED_RUNTIME_TARGETS.some((target) => pathsOverlap(entry.target, target))
    ) {
      issues.push(`${label} overlaps reserved Drydock runtime: ${entry.target}`);
    }

    if (entry.overlay) {
      overlays.push({ entry, index });
    } else {
      baseEntries.push({ entry, index });
    }
  }

  for (let left = 0; left < baseEntries.length; left += 1) {
    for (let right = left + 1; right < baseEntries.length; right += 1) {
      if (pathsOverlap(baseEntries[left].entry.target, baseEntries[right].entry.target)) {
        issues.push(
          `base runtime targets overlap: ${baseEntries[left].entry.target} and ${baseEntries[right].entry.target}`
        );
      }
    }
  }

  const overlayTargets = new Set();
  for (const { entry, index } of overlays) {
    const portableTarget = portablePathKey(entry.target);
    if (overlayTargets.has(portableTarget)) {
      issues.push(`multiple overlays target the same path: ${entry.target}`);
    }
    overlayTargets.add(portableTarget);

    if (!baseEntries.some((base) => targetCovered(base.entry.target, entry.target))) {
      issues.push(`runtime entry ${index} overlay target is not supplied by a base mapping: ${entry.target}`);
    }
  }

  const entrypointIssue = safeRelativePathIssue(descriptor.runtime.entrypoint);
  if (entrypointIssue) {
    issues.push(
      `runtime entrypoint ${entrypointIssue}: ${descriptor.runtime.entrypoint}`
    );
  } else if (
    !baseEntries.some((base) => targetCovered(base.entry.target, descriptor.runtime.entrypoint))
  ) {
    issues.push(`runtime entrypoint is not supplied by a base mapping: ${descriptor.runtime.entrypoint}`);
  }
  if (
    !entrypointIssue
    && descriptor.runtime.entrypoint !== "index.html"
    && baseEntries.some((base) => pathsOverlap(base.entry.target, "index.html"))
  ) {
    issues.push(
      `custom runtime entrypoint requires index.html for Drydock web routing: ${descriptor.runtime.entrypoint}`
    );
  }

  return issues;
}

export async function validateProjectCommand({ args, context, stderr, stdout }) {
  const profile = parseValidationProfile(args);
  if (profile.error) {
    stderr.write(`ERROR: ${profile.error}\n`);
    return 2;
  }

  try {
    const project = await loadProject(context);
    const { verifyProjectComponents } = await import("./components.js");
    const verified = await verifyProjectComponents(project, {
      profile: profile.value
    });
    const { createRuntimeComposition } = await import("./composition.js");
    await createRuntimeComposition(verified);
    const { descriptor } = project;
    stdout.write(
      `valid Drydock project: ${descriptor.product.id} `
      + `(schema ${descriptor.schemaVersion}, contract ${descriptor.drydockContract}, `
      + `host ${descriptor.host.protocol}, profile ${profile.value})\n`
    );
    return 0;
  } catch (error) {
    const { ComponentValidationError } = await import("./components.js");
    const { CompositionError } = await import("./composition.js");
    if (
      !(error instanceof ProjectValidationError)
      && !(error instanceof ComponentValidationError)
      && !(error instanceof CompositionError)
    ) {
      throw error;
    }

    stderr.write(`${error.message}\n`);
    return 1;
  }
}

function parseValidationProfile(args) {
  if (args.length === 0) {
    return {
      value: "development"
    };
  }

  if (args.length === 2 && args[0] === "--profile") {
    if (args[1] === "development" || args[1] === "release") {
      return {
        value: args[1]
      };
    }

    return {
      error: `unknown validation profile: ${args[1]}`
    };
  }

  return {
    error: `usage: validate [--profile development|release]`
  };
}

async function readDescriptor(projectPath) {
  let contents;
  try {
    contents = await readFile(projectPath, "utf8");
  } catch (error) {
    throw new ProjectValidationError(
      `cannot read project descriptor: ${error.message}`
    );
  }

  try {
    return JSON.parse(contents);
  } catch (error) {
    throw new ProjectValidationError(
      `project descriptor is not valid JSON: ${error.message}`
    );
  }
}

async function loadSchemaValidator(harnessRoot) {
  const schemaPath = resolve(
    harnessRoot,
    "contracts/schemas/drydock-project.schema.json"
  );
  let validate = validatorBySchemaPath.get(schemaPath);

  if (validate) {
    return validate;
  }

  const schema = JSON.parse(await readFile(schemaPath, "utf8"));
  validate = new Ajv2020({
    allErrors: true,
    strict: true
  }).compile(schema);
  validatorBySchemaPath.set(schemaPath, validate);
  return validate;
}

function formatSchemaError(error) {
  const location = error.instancePath || "/";
  return `${location} ${error.message}`;
}

function safeRelativePathIssue(value) {
  if (typeof value !== "string" || value.length === 0) {
    return "must be a non-empty relative path";
  }

  if (
    value.startsWith("/")
    || value.includes("\\")
    || value.endsWith("/")
    || value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    return "must be a normalized project-relative path";
  }

  return null;
}

function pathsOverlap(left, right) {
  const portableLeft = portablePathKey(left);
  const portableRight = portablePathKey(right);
  return (
    portableLeft === portableRight
    || portableLeft.startsWith(`${portableRight}/`)
    || portableRight.startsWith(`${portableLeft}/`)
  );
}

function targetCovered(baseTarget, target) {
  return target === baseTarget || target.startsWith(`${baseTarget}/`);
}

function portablePathKey(path) {
  return path.toLowerCase();
}
