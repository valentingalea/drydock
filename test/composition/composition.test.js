import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import {
  CompositionError,
  createRuntimeComposition,
  readRuntimeFile,
  stageRuntime
} from "../../tools/composition.js";
import { verifyProjectComponents } from "../../tools/components.js";
import { resolveProjectContext } from "../../tools/drydock.js";
import { loadProject } from "../../tools/project.js";

const harnessRoot = resolve(import.meta.dirname, "../..");
const validFixturePath = resolve(
  harnessRoot,
  "contracts/fixtures/projects/valid/minimal.json"
);

test("uses the same mappings and overlay order for live reads and staging", async (context) => {
  const fixture = await createGitProject(context);
  const composition = await loadComposition(fixture);
  const output = join(fixture.projectRoot, "artifacts", "runtime");
  const expected = new Map([
    ["index.html", "<!doctype html>\n"],
    ["game/src/value.js", "export const value = 42;\n"],
    ["game/src/platform-host.js", "export const platform = \"overlay\";\n"],
    [
      "host-bridge.js",
      await readFile(join(harnessRoot, "runtime/web/host-bridge.js"), "utf8")
    ],
    [
      "vendor/drydock-host-bridge/index.js",
      await readFile(
        join(harnessRoot, "runtime/web/vendor/drydock-host-bridge/index.js"),
        "utf8"
      )
    ]
  ]);

  await stageRuntime(composition, output);

  for (const [runtimePath, contents] of expected) {
    const live = await readRuntimeFile(composition, `/${runtimePath}`);
    assert.ok(live, runtimePath);
    assert.equal(live.contents.toString(), contents, runtimePath);
    assert.equal(
      await readFile(join(output, ...runtimePath.split("/")), "utf8"),
      contents,
      runtimePath
    );
  }

  assert.equal((await readRuntimeFile(composition, "/")).target, "index.html");
  assert.equal(
    (await readRuntimeFile(composition, "/game/src/platform-host.js")).owner,
    "shipping"
  );
});

test("rejects unsafe live requests and returns null for absent files", async (context) => {
  const composition = await loadComposition(await createGitProject(context));

  assert.equal(await readRuntimeFile(composition, "/missing.js"), null);
  for (const request of [
    "/../outside.js",
    "/game/%2e%2e/outside.js",
    "/game\\outside.js",
    "/game/%00outside.js"
  ]) {
    await assert.rejects(
      readRuntimeFile(composition, request),
      CompositionError,
      request
    );
  }
});

test("rechecks containment after a source is replaced by an escaping link", async (context) => {
  const fixture = await createGitProject(context);
  const composition = await loadComposition(fixture);
  const source = join(fixture.projectRoot, "game", "src", "value.js");
  const external = join(fixture.root, "outside.js");
  await writeFile(external, "export const outside = true;\n");
  await rm(source);
  await symlink(external, source);

  await assert.rejects(
    readRuntimeFile(composition, "/game/src/value.js"),
    /runtime read escapes game/
  );
  await assert.rejects(
    stageRuntime(
      composition,
      join(fixture.projectRoot, "artifacts", "link-swap")
    ),
    /runtime directory entry escapes game/
  );
});

test("rejects a broken source link after composition", async (context) => {
  const fixture = await createGitProject(context);
  const composition = await loadComposition(fixture);
  const source = join(fixture.projectRoot, "game", "src", "value.js");
  await rm(source);
  await symlink("missing.js", source);

  await assert.rejects(
    readRuntimeFile(composition, "/game/src/value.js"),
    /runtime source link cannot be resolved in game/
  );
  await assert.rejects(
    stageRuntime(
      composition,
      join(fixture.projectRoot, "artifacts", "broken-link")
    ),
    /runtime entry cannot be resolved in game/
  );
});

test("permits links that remain within their owning component", async (context) => {
  const fixture = await createGitProject(context, undefined, async ({ gameRoot }) => {
    await writeFile(join(gameRoot, "shared.js"), "export const shared = true;\n");
    await symlink("../shared.js", join(gameRoot, "src", "shared-link.js"));
  });
  const composition = await loadComposition(fixture);
  const output = join(fixture.projectRoot, "artifacts", "internal-link");

  assert.equal(
    (await readRuntimeFile(composition, "/game/src/shared-link.js")).contents.toString(),
    "export const shared = true;\n"
  );
  await stageRuntime(composition, output);
  assert.equal(
    await readFile(join(output, "game/src/shared-link.js"), "utf8"),
    "export const shared = true;\n"
  );
});

test("rejects restricted descendants and symbolic-link cycles", async (context) => {
  const restricted = await createGitProject(
    context,
    undefined,
    async ({ gameRoot }) => {
      await mkdir(join(gameRoot, "src", "tests"));
      await writeFile(join(gameRoot, "src", "tests", "private.js"), "private\n");
    }
  );
  await assert.rejects(
    loadComposition(restricted),
    /runtime source selects a restricted path in game/
  );

  const cyclic = await createGitProject(
    context,
    undefined,
    async ({ gameRoot }) => {
      await symlink(".", join(gameRoot, "src", "cycle"));
    }
  );
  await assert.rejects(
    loadComposition(cyclic),
    /runtime directory contains a symbolic-link cycle in game/
  );
});

test("requires file-only shipping integrations and type-compatible overlays", async (context) => {
  const shippingDirectory = await createGitProject(context, (descriptor) => {
    const overlay = descriptor.runtime.entries.find((entry) => entry.overlay);
    overlay.source = "integrations/drydock";
    overlay.target = "game/src";
  });
  await assert.rejects(
    loadComposition(shippingDirectory),
    /shipping integration must be an explicit file/
  );

  const typeChange = await createGitProject(
    context,
    (descriptor) => {
      const overlay = descriptor.runtime.entries.find((entry) => entry.overlay);
      overlay.component = "game";
      overlay.source = "overlay-directory";
    },
    async ({ gameRoot }) => {
      await mkdir(join(gameRoot, "overlay-directory"));
      await writeFile(join(gameRoot, "overlay-directory", "index.js"), "overlay\n");
    }
  );
  await assert.rejects(
    loadComposition(typeChange),
    /runtime overlay changes target type .*file to directory/
  );
});

test("contains staging below a new, empty artifact subdirectory", async (context) => {
  const fixture = await createGitProject(context);
  const composition = await loadComposition(fixture);
  const artifactRoot = join(fixture.projectRoot, "artifacts");
  const outside = join(fixture.root, "outside");
  await mkdir(outside);

  await assert.rejects(
    stageRuntime(composition, artifactRoot),
    /stage output must be below the project artifact root/
  );
  await assert.rejects(
    stageRuntime(composition, join(fixture.projectRoot, "elsewhere")),
    /stage output must be below the project artifact root/
  );

  await mkdir(artifactRoot, {
    recursive: true
  });
  await symlink(outside, join(artifactRoot, "escaped"));
  await assert.rejects(
    stageRuntime(composition, join(artifactRoot, "escaped", "runtime")),
    /stage output path must not contain symbolic links/
  );

  const nonempty = join(artifactRoot, "nonempty");
  await mkdir(nonempty);
  await writeFile(join(nonempty, "existing.txt"), "existing\n");
  await assert.rejects(
    stageRuntime(composition, nonempty),
    /stage output directory must be empty/
  );

  const linkedFixture = await createGitProject(context);
  const linkedComposition = await loadComposition(linkedFixture);
  const linkedArtifactRoot = join(linkedFixture.projectRoot, "artifacts");
  await symlink(outside, linkedArtifactRoot);
  await assert.rejects(
    stageRuntime(linkedComposition, join(linkedArtifactRoot, "runtime")),
    /artifact root must not be a symbolic link/
  );
});

async function createGitProject(
  context,
  mutateDescriptor,
  populateProject
) {
  const root = await mkdtemp(join(tmpdir(), "drydock-composition-"));
  context.after(() => rm(root, {
    force: true,
    recursive: true
  }));
  const projectRoot = join(root, "project");
  const gameRoot = join(projectRoot, "game");
  const shippingRoot = join(projectRoot, "shipping");
  const integrationRoot = join(shippingRoot, "integrations", "drydock");
  const descriptor = JSON.parse(await readFile(validFixturePath, "utf8"));

  await mutateDescriptor?.(descriptor);
  await mkdir(join(gameRoot, "src"), {
    recursive: true
  });
  await mkdir(integrationRoot, {
    recursive: true
  });
  await writeFile(join(gameRoot, "index.html"), "<!doctype html>\n");
  await writeFile(
    join(gameRoot, "src", "platform-host.js"),
    "export const platform = \"fallback\";\n"
  );
  await writeFile(
    join(gameRoot, "src", "value.js"),
    "export const value = 42;\n"
  );
  await writeFile(
    join(integrationRoot, "platform-host.js"),
    "export const platform = \"overlay\";\n"
  );
  await writeFile(
    join(shippingRoot, "drydock-project.json"),
    `${JSON.stringify(descriptor, null, 2)}\n`
  );
  await writeFile(join(projectRoot, ".gitignore"), "/artifacts/\n");
  await populateProject?.({
    gameRoot,
    projectRoot,
    shippingRoot
  });

  git(projectRoot, "init", "-b", "main");
  git(projectRoot, "config", "user.name", "Drydock Tests");
  git(projectRoot, "config", "user.email", "drydock-tests@example.invalid");
  git(projectRoot, "add", ".");
  git(projectRoot, "commit", "-m", "seed project");

  return {
    projectRoot,
    root
  };
}

async function loadComposition(fixture) {
  const projectContext = await resolveProjectContext(
    "shipping/drydock-project.json",
    {
      invocationCwd: fixture.projectRoot,
      selectedHarnessRoot: harnessRoot
    }
  );
  const project = await loadProject(projectContext);
  const verified = await verifyProjectComponents(project);
  return createRuntimeComposition(verified);
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
