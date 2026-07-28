import { execFileSync } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRuntimeComposition } from "../../tools/composition.js";
import { verifyProjectComponents } from "../../tools/components.js";
import { resolveProjectContext } from "../../tools/drydock.js";
import { loadProject } from "../../tools/project.js";

export const harnessRoot = resolve(import.meta.dirname, "../..");
const validFixturePath = resolve(
  harnessRoot,
  "contracts/fixtures/projects/valid/minimal.json"
);

export async function createMinimalProject(
  context,
  mutateDescriptor,
  populateProject
) {
  const root = await mkdtemp(join(tmpdir(), "drydock-project-"));
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
    root,
    shippingRoot
  });

  git(projectRoot, "init", "-b", "main");
  git(projectRoot, "config", "user.name", "Drydock Tests");
  git(projectRoot, "config", "user.email", "drydock-tests@example.invalid");
  git(projectRoot, "add", ".");
  git(projectRoot, "commit", "-m", "seed project");

  return {
    descriptor,
    projectPath: join(shippingRoot, "drydock-project.json"),
    projectRoot,
    root,
    shippingRoot
  };
}

export async function loadMinimalComposition(fixture) {
  const verified = await loadMinimalVerifiedProject(fixture);
  return createRuntimeComposition(verified);
}

export async function loadMinimalVerifiedProject(fixture, profile = "development") {
  const context = await resolveProjectContext(
    fixture.projectPath,
    {
      invocationCwd: fixture.projectRoot,
      selectedHarnessRoot: harnessRoot
    }
  );
  const project = await loadProject(context);
  return verifyProjectComponents(project, {
    profile
  });
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
