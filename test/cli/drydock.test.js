import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
import {
  CliUsageError,
  harnessRoot,
  helpText,
  parseCliArgs,
  resolveProjectContext,
  resolveProjectPath,
  runCli
} from "../../tools/drydock.js";

const entrypoint = resolve(import.meta.dirname, "../../tools/drydock.js");
const repositoryRoot = resolve(import.meta.dirname, "../..");

test("harness root derives from the CLI location", () => {
  assert.equal(harnessRoot, repositoryRoot);
});

test("parses the public command and preserves command-specific arguments", () => {
  assert.deepEqual(
    parseCliArgs([
      "build",
      "web-static",
      "--project",
      "shipping/drydock-project.json",
      "--release",
      "shipping/releases/0.1.0.yaml"
    ]),
    {
      command: "build",
      commandArgs: [
        "web-static",
        "--release",
        "shipping/releases/0.1.0.yaml"
      ],
      help: false,
      project: "shipping/drydock-project.json"
    }
  );
});

test("rejects missing, duplicate, and unknown global inputs", () => {
  assert.throws(
    () => parseCliArgs(["validate"]),
    new CliUsageError("--project is required")
  );
  assert.throws(
    () => parseCliArgs([
      "validate",
      "--project",
      "shipping/drydock-project.json",
      "--project=shipping/drydock-project.json"
    ]),
    new CliUsageError("--project may be provided only once")
  );
  assert.throws(
    () => parseCliArgs(["--unknown"]),
    new CliUsageError("unknown global option: --unknown")
  );
  assert.throws(
    () => parseCliArgs(["launch", "--project", "shipping/drydock-project.json"]),
    new CliUsageError("unknown command: launch")
  );
});

test("resolves the canonical project roots from the project argument", async (context) => {
  const fixture = await createProjectFixture(context);
  const selected = await resolveProjectContext(
    "game/shipping/drydock-project.json",
    {
      invocationCwd: fixture.root,
      selectedHarnessRoot: repositoryRoot
    }
  );

  assert.equal(selected.harnessRoot, repositoryRoot);
  assert.equal(selected.projectRoot, await realpath(fixture.projectRoot));
  assert.equal(selected.shippingRoot, await realpath(fixture.shippingRoot));
  assert.equal(selected.projectPath, await realpath(fixture.projectPath));
  assert.equal(
    selected.artifactRoot,
    join(await realpath(fixture.projectRoot), "artifacts")
  );
});

test("rejects a descriptor outside the canonical shipping location", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "drydock-cli-placement-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const descriptor = join(root, "game", "config", "drydock-project.json");
  await mkdir(dirname(descriptor), { recursive: true });
  await writeFile(descriptor, "{}\n");

  await assert.rejects(
    resolveProjectContext(descriptor, {
      invocationCwd: root
    }),
    new CliUsageError(
      "project descriptor must be shipping/drydock-project.json"
    )
  );
});

test("rejects a missing project descriptor with a usage error", async () => {
  await assert.rejects(
    resolveProjectContext("shipping/drydock-project.json", {
      invocationCwd: tmpdir()
    }),
    (error) => (
      error instanceof CliUsageError
      && error.message.startsWith("project descriptor does not exist:")
    )
  );
});

test("resolves later inputs only from the established project root", async (context) => {
  const fixture = await createProjectFixture(context);
  const selected = await resolveProjectContext(fixture.projectPath, {
    invocationCwd: tmpdir()
  });

  assert.equal(
    resolveProjectPath(selected, "shipping/releases/0.1.0.yaml", "release"),
    join(await realpath(fixture.projectRoot), "shipping/releases/0.1.0.yaml")
  );
  assert.throws(
    () => resolveProjectPath(selected, "../outside.yaml", "release"),
    new CliUsageError("release escapes the project root: ../outside.yaml")
  );
  assert.throws(
    () => resolveProjectPath(selected, fixture.projectPath, "release"),
    new CliUsageError("release must be a non-empty project-relative path")
  );
});

test("dispatch receives resolved context without reading the descriptor", async (context) => {
  const fixture = await createProjectFixture(context, "not-json\n");
  let received;
  const output = captureStream();
  const errors = captureStream();

  const exitCode = await runCli([
    "validate",
    "--project",
    fixture.projectPath
  ], {
    commands: {
      validate: (value) => {
        received = value;
      }
    },
    invocationCwd: tmpdir(),
    stderr: errors,
    stdout: output
  });

  assert.equal(exitCode, 0);
  assert.equal(received.context.projectPath, await realpath(fixture.projectPath));
  assert.deepEqual(received.args, []);
  assert.equal(output.value, "");
  assert.equal(errors.value, "");
});

test("help requires no project and produces no error", async () => {
  const output = captureStream();
  const errors = captureStream();
  const exitCode = await runCli(["--help"], {
    stderr: errors,
    stdout: output
  });

  assert.equal(exitCode, 0);
  assert.equal(output.value, helpText());
  assert.equal(errors.value, "");
});

test("public iteration command rejects unknown adapters before project loading", async (context) => {
  const fixture = await createProjectFixture(context, "not-json\n");
  const output = captureStream();
  const errors = captureStream();
  const exitCode = await runCli([
    "iterate",
    "unknown",
    "--project",
    fixture.projectPath
  ], {
    invocationCwd: fixture.projectRoot,
    stderr: errors,
    stdout: output
  });

  assert.equal(exitCode, 2);
  assert.equal(output.value, "");
  assert.match(errors.value, /usage: iterate web/);
  assert.doesNotMatch(errors.value, /invalid Drydock project/);
});

test("public build command rejects unknown adapters before project loading", async (context) => {
  const fixture = await createProjectFixture(context, "not-json\n");
  const output = captureStream();
  const errors = captureStream();
  const exitCode = await runCli([
    "build",
    "unknown",
    "--project",
    fixture.projectPath
  ], {
    invocationCwd: fixture.projectRoot,
    stderr: errors,
    stdout: output
  });

  assert.equal(exitCode, 2);
  assert.equal(output.value, "");
  assert.match(errors.value, /usage: build <web-static\|electron>/);
  assert.doesNotMatch(errors.value, /invalid Drydock project/);
});

test("importing the CLI from an empty directory has no observable side effects", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "drydock-cli-import-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const moduleUrl = pathToFileURL(entrypoint).href;
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "--eval",
      `await import(${JSON.stringify(moduleUrl)})`
    ],
    {
      cwd: root,
      encoding: "utf8"
    }
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});

async function createProjectFixture(context, contents = "{}\n") {
  const root = await mkdtemp(join(tmpdir(), "drydock-cli-project-"));
  context.after(() => rm(root, { force: true, recursive: true }));
  const projectRoot = join(root, "game");
  const shippingRoot = join(projectRoot, "shipping");
  const projectPath = join(shippingRoot, "drydock-project.json");
  await mkdir(shippingRoot, { recursive: true });
  await writeFile(projectPath, contents);

  return {
    projectPath,
    projectRoot,
    root,
    shippingRoot
  };
}

function captureStream() {
  return {
    value: "",
    write(chunk) {
      this.value += chunk;
    }
  };
}
