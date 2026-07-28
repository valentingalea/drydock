import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { resolveProjectContext } from "../../tools/drydock.js";
import {
  DRYDOCK_CONTRACT_VERSION,
  PROJECT_SCHEMA_VERSION,
  ProjectValidationError,
  loadProject,
  validateProjectSemantics
} from "../../tools/project.js";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const entrypoint = resolve(repositoryRoot, "tools/drydock.js");
const fixturesRoot = resolve(repositoryRoot, "contracts/fixtures/projects");
const templateRoot = resolve(repositoryRoot, "templates/project");

test("loads the generic valid project fixture", async (context) => {
  const fixture = await createProjectFromFixture(context, "valid/minimal.json");
  const selected = await resolveProjectContext(fixture.projectPath, {
    invocationCwd: fixture.root
  });
  const project = await loadProject(selected);

  assert.equal(project.descriptor.schemaVersion, PROJECT_SCHEMA_VERSION);
  assert.equal(project.descriptor.drydockContract, DRYDOCK_CONTRACT_VERSION);
  assert.equal(project.descriptor.product.id, "fixture-game");
  assert.equal(project.descriptor.host.protocol, 1);
  assert.deepEqual(project.descriptor.host.requiredCapabilities, ["storage"]);
});

test("the portable project template satisfies project and release contracts", async (context) => {
  const descriptor = JSON.parse(
    await readFile(
      resolve(templateRoot, "shipping/drydock-project.json"),
      "utf8"
    )
  );
  const fixture = await createProject(context, descriptor);
  await initializeProjectRepository(fixture);
  const projectResult = spawnSync(
    process.execPath,
    [
      entrypoint,
      "validate",
      "--project",
      "shipping/drydock-project.json"
    ],
    {
      cwd: fixture.projectRoot,
      encoding: "utf8"
    }
  );
  const releaseResult = spawnSync(
    process.execPath,
    [
      resolve(repositoryRoot, "tools/scripts/validate-release.js"),
      resolve(templateRoot, "shipping/releases/0.1.0.yaml")
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8"
    }
  );

  assert.equal(projectResult.status, 0, projectResult.stderr);
  assert.equal(releaseResult.status, 0, releaseResult.stderr);
});

test("rejects an unsupported Drydock contract independently of schema shape", async (context) => {
  const fixture = await createProjectFromFixture(
    context,
    "invalid/unsupported-contract.json"
  );
  const selected = await resolveProjectContext(fixture.projectPath, {
    invocationCwd: fixture.root
  });

  await assert.rejects(
    loadProject(selected),
    (error) => (
      error instanceof ProjectValidationError
      && error.issues.includes("unsupported Drydock contract 2; supported: 1")
    )
  );
});

test("rejects unsupported schema and host protocol versions separately", async () => {
  const descriptor = await readFixture("valid/minimal.json");
  descriptor.schemaVersion = 2;
  descriptor.host.protocol = 2;

  assert.deepEqual(
    validateProjectSemantics(descriptor).filter((issue) => issue.startsWith("unsupported")),
    [
      "unsupported project schema version 2; supported: 1",
      "unsupported host protocol 2; supported: 1"
    ]
  );
});

test("rejects unknown components and unsafe component paths", async (context) => {
  const unknown = await createProjectFromFixture(
    context,
    "invalid/unknown-component.json"
  );
  const unsafe = await createProjectFromFixture(
    context,
    "invalid/unsafe-component.json"
  );

  await assert.rejects(
    loadProject(await resolveProjectContext(unknown.projectPath, {
      invocationCwd: unknown.root
    })),
    (error) => (
      error instanceof ProjectValidationError
      && error.issues.includes("runtime entry 0 references unknown component: missing")
    )
  );

  await assert.rejects(
    loadProject(await resolveProjectContext(unsafe.projectPath, {
      invocationCwd: unsafe.root
    })),
    (error) => (
      error instanceof ProjectValidationError
      && error.issues.includes(
        "component game path must be a normalized project-relative path: ../game"
      )
    )
  );
});

test("schema rejects unknown host capabilities and revision modes", async (context) => {
  const descriptor = await readFixture("valid/minimal.json");
  descriptor.host.requiredCapabilities.push("timeTravel");
  descriptor.components.game.revision = "floating";
  const fixture = await createProject(context, descriptor);
  const selected = await resolveProjectContext(fixture.projectPath, {
    invocationCwd: fixture.root
  });

  await assert.rejects(
    loadProject(selected),
    (error) => (
      error instanceof ProjectValidationError
      && error.issues.some((issue) => issue.includes("must be equal to one of the allowed values"))
    )
  );
});

test("rejects a product display name that can escape platform output paths", async () => {
  const descriptor = await readFixture("valid/minimal.json");
  descriptor.product.name = "../escaped";

  assert.ok(
    validateProjectSemantics(descriptor).includes(
      "product name must be safe for a platform application filename"
    )
  );
});

test("rejects overlapping component roots and reserved component roots", async () => {
  const descriptor = await readFixture("valid/minimal.json");
  descriptor.components.assets = {
    path: "game/assets",
    revision: "project"
  };
  descriptor.components.harness = {
    path: "drydock",
    revision: "gitlink"
  };

  const issues = validateProjectSemantics(descriptor);
  assert.equal(
    issues.includes("component harness uses reserved root: drydock"),
    true
  );
  assert.equal(
    issues.includes("component roots overlap: game (game) and assets (game/assets)"),
    true
  );
});

test("rejects unsafe shipping sources, reserved targets, and ambiguous mappings", async () => {
  const descriptor = await readFixture("valid/minimal.json");
  descriptor.runtime.entries.push(
    {
      component: "shipping",
      source: "releases/0.1.0.yaml",
      target: "release.yaml"
    },
    {
      component: "game",
      source: "host.js",
      target: "host-bridge.js"
    },
    {
      component: "game",
      source: "other",
      target: "game"
    },
    {
      component: "game",
      source: "replacement.js",
      target: "missing/replacement.js",
      overlay: true
    },
    {
      component: "game",
      source: "manifest.json",
      target: "drydock-artifact.json"
    }
  );

  const issues = validateProjectSemantics(descriptor);
  assert.equal(
    issues.includes(
      "runtime entry 3 may select only explicit shipping integrations: "
      + "shipping/releases/0.1.0.yaml"
    ),
    true
  );
  assert.equal(
    issues.includes("runtime entry 4 overlaps reserved Drydock runtime: host-bridge.js"),
    true
  );
  assert.equal(
    issues.includes("base runtime targets overlap: game/src and game"),
    true
  );
  assert.equal(
    issues.includes(
      "runtime entry 6 overlay target is not supplied by a base mapping: missing/replacement.js"
    ),
    true
  );
  assert.equal(
    issues.includes(
      "runtime entry 7 overlaps reserved Drydock runtime: drydock-artifact.json"
    ),
    true
  );
});

test("applies source restrictions to component roots and nested shipping roots", async () => {
  const descriptor = await readFixture("valid/minimal.json");
  descriptor.components.private = {
    path: "private/Secrets",
    revision: "project"
  };
  descriptor.components.channel = {
    path: "shipping/channels",
    revision: "project"
  };
  descriptor.runtime.entries.push(
    {
      component: "private",
      source: "runtime.js",
      target: "private/runtime.js"
    },
    {
      component: "channel",
      source: "vps.yaml",
      target: "channel/vps.yaml"
    }
  );

  const issues = validateProjectSemantics(descriptor);
  assert.ok(
    issues.includes(
      "runtime entry 3 selects restricted project source: "
      + "private/Secrets/runtime.js"
    )
  );
  assert.ok(
    issues.includes(
      "runtime entry 4 may select only explicit shipping integrations: "
      + "shipping/channels/vps.yaml"
    )
  );
});

test("requires shipping integrations to overlay game runtime", async () => {
  const descriptor = await readFixture("valid/minimal.json");
  const integration = descriptor.runtime.entries.find((entry) => entry.overlay);
  delete integration.overlay;

  assert.ok(
    validateProjectSemantics(descriptor).includes(
      "runtime entry 2 shipping integration must be an overlay: "
      + "shipping/integrations/drydock/platform-host.js"
    )
  );
});

test("rejects portable case-folded path collisions", async () => {
  const descriptor = await readFixture("valid/minimal.json");
  descriptor.components.cache = {
    path: "Artifacts/cache",
    revision: "project"
  };
  descriptor.runtime.entries.push(
    {
      component: "game",
      source: "host.js",
      target: "Host-Bridge.js"
    },
    {
      component: "game",
      source: "assets",
      target: "Game/SRC"
    },
    {
      component: "shipping",
      source: "integrations/drydock/alternate.js",
      target: "Game/SRC/Platform-Host.js",
      overlay: true
    }
  );

  const issues = validateProjectSemantics(descriptor);
  assert.ok(
    issues.includes("component cache uses reserved root: Artifacts/cache")
  );
  assert.ok(
    issues.includes("runtime entry 3 overlaps reserved Drydock runtime: Host-Bridge.js")
  );
  assert.ok(
    issues.includes("base runtime targets overlap: game/src and Game/SRC")
  );
  assert.ok(
    issues.includes(
      "multiple overlays target the same path: Game/SRC/Platform-Host.js"
    )
  );
});

test("rejects channel-private runtime targets portably", async () => {
  const descriptor = await readFixture("valid/minimal.json");
  const targets = [
    ".Drydock-Channel",
    ".GIT/config",
    "Package.json",
    "Shipping/drydock-project.json"
  ];

  for (const [index, target] of targets.entries()) {
    descriptor.runtime.entries.push({
      component: "game",
      source: `private-${index}`,
      target
    });
  }

  const issues = validateProjectSemantics(descriptor);
  for (const [index, target] of targets.entries()) {
    assert.ok(
      issues.includes(
        `runtime entry ${index + 3} overlaps reserved Drydock runtime: ${target}`
      ),
      target
    );
  }
});

test("rejects an entrypoint that no base mapping supplies", async () => {
  const descriptor = await readFixture("valid/minimal.json");
  descriptor.runtime.entrypoint = "missing.html";

  assert.equal(
    validateProjectSemantics(descriptor).includes(
      "runtime entrypoint is not supplied by a base mapping: missing.html"
    ),
    true
  );
});

test("the public validate command accepts a valid descriptor", async (context) => {
  const fixture = await createProjectFromFixture(context, "valid/minimal.json");
  await initializeProjectRepository(fixture);
  const result = spawnSync(
    process.execPath,
    [
      entrypoint,
      "validate",
      "--project",
      "shipping/drydock-project.json"
    ],
    {
      cwd: fixture.projectRoot,
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    result.stdout,
    "valid Drydock project: fixture-game "
    + "(schema 1, contract 1, host 1, profile development)\n"
  );
  assert.equal(result.stderr, "");
});

test("the public validate command reports semantic errors without a stack trace", async (context) => {
  const fixture = await createProjectFromFixture(
    context,
    "invalid/unknown-component.json"
  );
  const result = spawnSync(
    process.execPath,
    [
      entrypoint,
      "validate",
      "--project",
      "shipping/drydock-project.json"
    ],
    {
      cwd: fixture.projectRoot,
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /runtime entry 0 references unknown component: missing/
  );
  assert.doesNotMatch(result.stderr, /\n\s+at /);
  assert.equal(result.stdout, "");
});

test("the public validate command rejects command-specific arguments", async (context) => {
  const fixture = await createProjectFromFixture(context, "valid/minimal.json");
  const result = spawnSync(
    process.execPath,
    [
      entrypoint,
      "validate",
      "--project",
      "shipping/drydock-project.json",
      "--extra"
    ],
    {
      cwd: fixture.projectRoot,
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 2);
  assert.match(
    result.stderr,
    /usage: validate \[--profile development\|release\]/
  );
});

test("the public validate command rejects a missing composed entrypoint", async (context) => {
  const descriptor = await readFixture("valid/minimal.json");
  descriptor.runtime.entrypoint = "ui/missing.html";
  descriptor.runtime.entries = descriptor.runtime.entries.filter(
    (entry) => entry.target !== "index.html"
  );
  descriptor.runtime.entries.push({
    component: "game",
    source: "src",
    target: "ui"
  });
  const fixture = await createProject(context, descriptor);
  await mkdir(join(fixture.projectRoot, "game", "src"), {
    recursive: true
  });
  await writeFile(
    join(fixture.projectRoot, "game", "src", "present.html"),
    "<!doctype html>\n"
  );
  await initializeProjectRepository(fixture);

  const result = spawnSync(
    process.execPath,
    [
      entrypoint,
      "validate",
      "--project",
      "shipping/drydock-project.json"
    ],
    {
      cwd: fixture.projectRoot,
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 1);
  assert.match(
    result.stderr,
    /runtime entrypoint is not a composed file: ui\/missing\.html/
  );
  assert.equal(result.stdout, "");
});

async function createProjectFromFixture(context, fixturePath) {
  return createProject(context, await readFixture(fixturePath));
}

async function createProject(context, descriptor) {
  const root = await mkdtemp(join(tmpdir(), "drydock-project-contract-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const projectRoot = join(root, "game");
  const shippingRoot = join(projectRoot, "shipping");
  const projectPath = join(shippingRoot, "drydock-project.json");
  await mkdir(shippingRoot, { recursive: true });
  await writeFile(projectPath, `${JSON.stringify(descriptor, null, 2)}\n`);
  return {
    projectPath,
    projectRoot,
    root
  };
}

async function readFixture(fixturePath) {
  return JSON.parse(
    await readFile(resolve(fixturesRoot, fixturePath), "utf8")
  );
}

async function initializeProjectRepository(fixture) {
  const gameRoot = join(fixture.projectRoot, "game");
  const integrationRoot = join(
    fixture.projectRoot,
    "shipping",
    "integrations",
    "drydock"
  );
  await mkdir(gameRoot, { recursive: true });
  await mkdir(join(gameRoot, "src"), { recursive: true });
  await mkdir(integrationRoot, { recursive: true });
  await writeFile(join(gameRoot, "index.html"), "<!doctype html>\n");
  await writeFile(
    join(gameRoot, "src", "platform-host.js"),
    "export const platform = \"fallback\";\n"
  );
  await writeFile(
    join(integrationRoot, "platform-host.js"),
    "export const platform = \"overlay\";\n"
  );
  git(fixture.projectRoot, "init", "-b", "main");
  git(fixture.projectRoot, "config", "user.name", "Drydock Test");
  git(fixture.projectRoot, "config", "user.email", "drydock-test@example.invalid");
  git(fixture.projectRoot, "add", ".");
  git(fixture.projectRoot, "commit", "-m", "seed fixture");
}

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: [
      "ignore",
      "pipe",
      "pipe"
    ]
  }).trim();
}
