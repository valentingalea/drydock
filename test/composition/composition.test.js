import assert from "node:assert/strict";
import {
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  CompositionError,
  readRuntimeFile,
  stageRuntime
} from "../../tools/composition.js";
import {
  createMinimalProject,
  harnessRoot,
  loadMinimalComposition
} from "../support/minimal-project.js";

test("uses the same mappings and overlay order for live reads and staging", async (context) => {
  const fixture = await createMinimalProject(context);
  const composition = await loadMinimalComposition(fixture);
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

test("routes the runtime root to a declared custom entrypoint", async (context) => {
  const fixture = await createMinimalProject(
    context,
    (descriptor) => {
      descriptor.runtime.entrypoint = "ui/start.html";
      descriptor.runtime.entries[0] = {
        component: "game",
        source: "start.html",
        target: "ui/start.html"
      };
    },
    async ({ gameRoot }) => {
      await writeFile(
        join(gameRoot, "start.html"),
        "<!doctype html><title>Custom entrypoint</title>\n"
      );
    }
  );
  const composition = await loadMinimalComposition(fixture);

  const root = await readRuntimeFile(composition, "/");
  assert.equal(root.target, "ui/start.html");
  assert.equal(
    root.contents.toString(),
    "<!doctype html><title>Custom entrypoint</title>\n"
  );
});

test("requires the final composed entrypoint to be a file", async (context) => {
  const fixture = await createMinimalProject(
    context,
    (descriptor) => {
      descriptor.runtime.entrypoint = "ui/missing.html";
      descriptor.runtime.entries = descriptor.runtime.entries.filter(
        (entry) => entry.target !== "index.html"
      );
      descriptor.runtime.entries.push({
        component: "game",
        source: "pages",
        target: "ui"
      });
    },
    async ({ gameRoot }) => {
      await mkdir(join(gameRoot, "pages"));
      await writeFile(
        join(gameRoot, "pages", "present.html"),
        "<!doctype html>\n"
      );
    }
  );

  await assert.rejects(
    loadMinimalComposition(fixture),
    /runtime entrypoint is not a composed file: ui\/missing\.html/
  );
});

test("rejects unsafe live requests and returns null for absent files", async (context) => {
  const composition = await loadMinimalComposition(
    await createMinimalProject(context)
  );

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
  const fixture = await createMinimalProject(context);
  const composition = await loadMinimalComposition(fixture);
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
  const fixture = await createMinimalProject(context);
  const composition = await loadMinimalComposition(fixture);
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
  const fixture = await createMinimalProject(context, undefined, async ({ gameRoot }) => {
    await writeFile(join(gameRoot, "shared.js"), "export const shared = true;\n");
    await symlink("../shared.js", join(gameRoot, "src", "shared-link.js"));
  });
  const composition = await loadMinimalComposition(fixture);
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
  const restricted = await createMinimalProject(
    context,
    undefined,
    async ({ gameRoot }) => {
      await mkdir(join(gameRoot, "src", "Tests"));
      await writeFile(join(gameRoot, "src", "Tests", "private.js"), "private\n");
    }
  );
  await assert.rejects(
    loadMinimalComposition(restricted),
    /runtime source selects a restricted path in game/
  );

  const cyclic = await createMinimalProject(
    context,
    undefined,
    async ({ gameRoot }) => {
      await symlink(".", join(gameRoot, "src", "cycle"));
    }
  );
  await assert.rejects(
    loadMinimalComposition(cyclic),
    /runtime directory contains a symbolic-link cycle in game/
  );
});

test("requires file-only shipping integrations and type-compatible overlays", async (context) => {
  const baseShippingIntegration = await createMinimalProject(
    context,
    (descriptor) => {
      const overlay = descriptor.runtime.entries.find((entry) => entry.overlay);
      delete overlay.overlay;
    }
  );
  await assert.rejects(
    loadMinimalComposition(baseShippingIntegration),
    /shipping integration must be an overlay/
  );

  const shippingDirectory = await createMinimalProject(context, (descriptor) => {
    const overlay = descriptor.runtime.entries.find((entry) => entry.overlay);
    overlay.source = "integrations/drydock";
    overlay.target = "game/src";
  });
  await assert.rejects(
    loadMinimalComposition(shippingDirectory),
    /shipping integration must be an explicit file/
  );

  const nestedShippingDirectory = await createMinimalProject(
    context,
    (descriptor) => {
      descriptor.components.shipping.path = "shipping/integrations";
      const overlay = descriptor.runtime.entries.find((entry) => entry.overlay);
      overlay.source = "drydock";
      overlay.target = "game/src";
    }
  );
  await assert.rejects(
    loadMinimalComposition(nestedShippingDirectory),
    /shipping integration must be an explicit file/
  );

  const typeChange = await createMinimalProject(
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
    loadMinimalComposition(typeChange),
    /runtime overlay changes target type .*file to directory/
  );
});

test("contains staging below a new, empty artifact subdirectory", async (context) => {
  const fixture = await createMinimalProject(context);
  const composition = await loadMinimalComposition(fixture);
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

  const linkedFixture = await createMinimalProject(context);
  const linkedComposition = await loadMinimalComposition(linkedFixture);
  const linkedArtifactRoot = join(linkedFixture.projectRoot, "artifacts");
  await symlink(outside, linkedArtifactRoot);
  await assert.rejects(
    stageRuntime(linkedComposition, join(linkedArtifactRoot, "runtime")),
    /artifact root must not be a symbolic link/
  );
});
