import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  appendFile,
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
  ComponentValidationError,
  verifyProjectComponents
} from "../../tools/components.js";
import { resolveProjectContext } from "../../tools/drydock.js";
import { loadProject } from "../../tools/project.js";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const entrypoint = resolve(repositoryRoot, "tools/drydock.js");
const validFixturePath = resolve(
  repositoryRoot,
  "contracts/fixtures/projects/valid/minimal.json"
);

test("resolves canonical project-owned component roots", async (context) => {
  const fixture = await createGitProject(context);
  const verified = await loadAndVerify(fixture);

  assert.equal(verified.profile, "development");
  assert.equal(verified.components.game.root, join(fixture.projectRoot, "game"));
  assert.equal(verified.components.game.revision, "project");
  assert.equal(
    verified.components.shipping.root,
    join(fixture.projectRoot, "shipping")
  );
  assert.equal(
    verified.projectRevision.commit,
    git(fixture.projectRoot, "rev-parse", "HEAD")
  );
});

test("rejects missing and untracked project components", async (context) => {
  const missing = await createGitProject(context);
  await rm(join(missing.projectRoot, "game"), {
    force: true,
    recursive: true
  });

  await assert.rejects(
    loadAndVerify(missing),
    hasIssue("component game is missing: game")
  );

  const untracked = await createGitProject(context, (descriptor) => {
    descriptor.components.assets = {
      path: "assets",
      revision: "project"
    };
  });
  await mkdir(join(untracked.projectRoot, "assets"));
  await writeFile(join(untracked.projectRoot, "assets", "local.txt"), "untracked\n");

  await assert.rejects(
    loadAndVerify(untracked),
    hasIssue("project component assets has no tracked files")
  );
});

test("treats descriptor component paths as literal Git pathspecs", async (context) => {
  const path = ":(glob)**";
  const fixture = await createGitProject(
    context,
    async (descriptor, { projectRoot }) => {
      descriptor.components.generated = {
        path,
        revision: "project"
      };
      await mkdir(join(projectRoot, path), {
        recursive: true
      });
      await writeFile(
        join(projectRoot, path, "ignored.js"),
        "export const ignored = true;\n"
      );
    },
    {
      ignoredPaths: [
        `/${path}/`
      ]
    }
  );

  await assert.rejects(
    loadAndVerify(fixture),
    hasIssue("project component generated has no tracked files")
  );
});

test("rejects a component root that becomes a symbolic link", async (context) => {
  const fixture = await createGitProject(context);
  const external = join(fixture.root, "external-game");
  await mkdir(external);
  await rm(join(fixture.projectRoot, "game"), {
    force: true,
    recursive: true
  });
  await symlink(external, join(fixture.projectRoot, "game"));

  await assert.rejects(
    loadAndVerify(fixture),
    hasIssue("component game root must not be a symbolic link: game")
  );
});

test("accepts an initialized checkout at its exact gitlink pin", async (context) => {
  const fixture = await createGitProject(context, addEngineGitlink);
  const verified = await loadAndVerify(fixture);

  assert.equal(verified.components.engine.revision, "gitlink");
  assert.equal(
    verified.components.engine.commit,
    git(join(fixture.projectRoot, "engine"), "rev-parse", "HEAD")
  );
});

test("rejects a gitlink declaration backed by an ordinary tracked directory", async (context) => {
  const fixture = await createGitProject(context, addEngineGitlink, {
    skipGitlinkCheckout: true
  });

  await assert.rejects(
    loadAndVerify(fixture),
    hasIssue("gitlink component engine is not an exact submodule entry: engine")
  );
});

test("rejects a gitlink checkout advanced beyond its recorded pin", async (context) => {
  const fixture = await createGitProject(context, addEngineGitlink);
  const engineRoot = join(fixture.projectRoot, "engine");
  configureRepository(engineRoot);
  await writeFile(join(engineRoot, "local.txt"), "local commit\n");
  git(engineRoot, "add", "local.txt");
  git(engineRoot, "commit", "-m", "advance checkout only");

  await assert.rejects(
    loadAndVerify(fixture),
    (error) => (
      error instanceof ComponentValidationError
      && error.issues.some((issue) => (
        issue.startsWith("gitlink component engine checkout ")
        && issue.includes(" does not match pin ")
      ))
    )
  );
});

test("release profile accepts clean commits reachable from local origins", async (context) => {
  const fixture = await createGitProject(context, addEngineGitlink, {
    projectRemote: true
  });
  const verified = await loadAndVerify(fixture, "release");

  assert.equal(verified.profile, "release");
  assert.equal(verified.components.engine.revision, "gitlink");

  const result = spawnSync(
    process.execPath,
    [
      entrypoint,
      "validate",
      "--project",
      "shipping/drydock-project.json",
      "--profile",
      "release"
    ],
    {
      cwd: fixture.projectRoot,
      encoding: "utf8"
    }
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /profile release/);
});

test("release profile rejects dirty and local-only project commits", async (context) => {
  const dirty = await createGitProject(context, undefined, {
    projectRemote: true
  });
  await appendFile(join(dirty.projectRoot, "game", "index.html"), "dirty\n");

  await assert.rejects(
    loadAndVerify(dirty, "release"),
    hasIssue("project repository has local changes")
  );

  const localOnly = await createGitProject(context, undefined, {
    projectRemote: true
  });
  await writeFile(join(localOnly.projectRoot, "local.txt"), "local only\n");
  git(localOnly.projectRoot, "add", "local.txt");
  git(localOnly.projectRoot, "commit", "-m", "local only");
  const localCommit = git(localOnly.projectRoot, "rev-parse", "HEAD");

  await assert.rejects(
    loadAndVerify(localOnly, "release"),
    hasIssue(`project repository commit ${localCommit} is not reachable from origin`)
  );
});

test("release profile rejects ignored content selected by runtime mappings", async (context) => {
  const fixture = await createGitProject(context, undefined, {
    ignoredPaths: [
      "/game/src/generated.js",
      "/local-cache/"
    ],
    projectRemote: true
  });
  await writeFile(
    join(fixture.projectRoot, "game", "src", "generated.js"),
    "export const generated = true;\n"
  );
  await mkdir(join(fixture.projectRoot, "local-cache"));
  await writeFile(
    join(fixture.projectRoot, "local-cache", "ignored.txt"),
    "not a runtime input\n"
  );

  await assert.rejects(
    loadAndVerify(fixture, "release"),
    hasIssue(
      "release runtime source has untracked content: game/src "
      + "(game/src/generated.js)"
    )
  );

  await rm(join(fixture.projectRoot, "game", "src", "generated.js"));
  const verified = await loadAndVerify(fixture, "release");
  assert.equal(verified.profile, "release");
});

test("release profile rejects ignored content reached through a tracked link", async (context) => {
  const fixture = await createGitProject(context, undefined, {
    ignoredPaths: [
      "/game/generated/"
    ],
    projectRemote: true
  });
  await mkdir(join(fixture.projectRoot, "game", "generated"));
  await writeFile(
    join(fixture.projectRoot, "game", "generated", "runtime.js"),
    "export const generated = true;\n"
  );
  await symlink(
    "../generated/runtime.js",
    join(fixture.projectRoot, "game", "src", "generated.js")
  );
  git(fixture.projectRoot, "add", "game/src/generated.js");
  git(fixture.projectRoot, "commit", "-m", "add generated runtime link");
  git(fixture.projectRoot, "push", "origin", "main");

  await assert.rejects(
    loadAndVerify(fixture, "release"),
    hasIssue(
      "release runtime source has untracked content: game/src "
      + "(game/generated/runtime.js)"
    )
  );
});

async function createGitProject(context, mutateDescriptor, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "drydock-components-"));
  context.after(() => rm(root, {
    force: true,
    recursive: true
  }));
  const projectRoot = join(root, "project");
  const shippingRoot = join(projectRoot, "shipping");
  const gameRoot = join(projectRoot, "game");
  const descriptor = JSON.parse(await readFile(validFixturePath, "utf8"));

  await mutateDescriptor?.(descriptor, {
    projectRoot,
    root
  });

  await mkdir(shippingRoot, {
    recursive: true
  });
  await mkdir(gameRoot, {
    recursive: true
  });
  await mkdir(join(gameRoot, "src"), {
    recursive: true
  });
  await mkdir(join(shippingRoot, "integrations", "drydock"), {
    recursive: true
  });
  await writeFile(join(gameRoot, "index.html"), "<!doctype html>\n");
  await writeFile(
    join(gameRoot, "src", "platform-host.js"),
    "export const platform = \"fallback\";\n"
  );
  await writeFile(
    join(shippingRoot, "integrations", "drydock", "platform-host.js"),
    "export const platform = \"overlay\";\n"
  );
  await writeFile(
    join(shippingRoot, "drydock-project.json"),
    `${JSON.stringify(descriptor, null, 2)}\n`
  );
  await writeFile(
    join(projectRoot, ".gitignore"),
    [
      "/artifacts/",
      ...(options.ignoredPaths ?? []),
      ""
    ].join("\n")
  );

  git(projectRoot, "init", "-b", "main");
  configureRepository(projectRoot);

  if (
    descriptor.components.engine?.revision === "gitlink"
    && !options.skipGitlinkCheckout
  ) {
    const engineRemote = await createEngineRemote(root);
    git(
      projectRoot,
      "-c",
      "protocol.file.allow=always",
      "submodule",
      "add",
      engineRemote,
      "engine"
    );
  } else if (descriptor.components.engine?.revision === "gitlink") {
    await mkdir(join(projectRoot, "engine", "src"), {
      recursive: true
    });
    await writeFile(
      join(projectRoot, "engine", "src", "engine.js"),
      "export const engine = true;\n"
    );
  }

  git(projectRoot, "add", ".");
  git(projectRoot, "commit", "-m", "seed project");

  if (options.projectRemote) {
    const projectRemote = join(root, "project.git");
    git(root, "init", "--bare", projectRemote);
    git(projectRoot, "remote", "add", "origin", projectRemote);
    git(projectRoot, "push", "-u", "origin", "main");
    git(projectRemote, "symbolic-ref", "HEAD", "refs/heads/main");
  }

  return {
    projectPath: join(shippingRoot, "drydock-project.json"),
    projectRoot,
    root
  };
}

function addEngineGitlink(descriptor) {
  descriptor.components.engine = {
    path: "engine",
    revision: "gitlink"
  };
  descriptor.runtime.entries.push({
    component: "engine",
    source: "src",
    target: "engine/src"
  });
}

async function createEngineRemote(root) {
  const remote = join(root, "engine.git");
  const source = join(root, "engine-source");
  git(root, "init", "--bare", remote);
  await mkdir(join(source, "src"), {
    recursive: true
  });
  git(source, "init", "-b", "main");
  configureRepository(source);
  await writeFile(join(source, "src", "engine.js"), "export const engine = true;\n");
  git(source, "add", ".");
  git(source, "commit", "-m", "seed engine");
  git(source, "remote", "add", "origin", remote);
  git(source, "push", "-u", "origin", "main");
  git(remote, "symbolic-ref", "HEAD", "refs/heads/main");
  return remote;
}

async function loadAndVerify(fixture, profile = "development") {
  const selected = await resolveProjectContext(fixture.projectPath, {
    invocationCwd: fixture.root
  });
  return verifyProjectComponents(await loadProject(selected), {
    profile
  });
}

function configureRepository(root) {
  git(root, "config", "user.name", "Drydock Test");
  git(root, "config", "user.email", "drydock-test@example.invalid");
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

function hasIssue(expected) {
  return (error) => (
    error instanceof ComponentValidationError
    && error.issues.includes(expected)
  );
}
