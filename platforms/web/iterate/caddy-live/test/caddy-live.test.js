import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  createServer,
  getProjectEntrypoint,
  parsePort,
  runtimePathAllowed
} from "../server.js";
import {
  createMinimalProject,
  loadMinimalComposition
} from "../../../../../test/support/minimal-project.js";

test("live origin selects the project-owned entrypoint", async (context) => {
  const composition = await createComposition(context);
  assert.equal(getProjectEntrypoint(composition), "index.html");
});

test("runtime allowlist comes only from normalized project composition", async (context) => {
  const composition = await createComposition(context);
  const allowed = [
    "/",
    "/index.html",
    "/host-bridge.js",
    "/vendor/drydock-host-bridge/index.js",
    "/game/src/value.js",
    "/game/src/platform-host.js"
  ];
  const denied = [
    "/package.json",
    "/../AGENTS.md",
    "/.git/config",
    "/shipping/drydock-project.json",
    "/game/index.html"
  ];

  for (const pathname of allowed) {
    assert.equal(
      await runtimePathAllowed(composition, pathname),
      true,
      pathname
    );
  }
  for (const pathname of denied) {
    assert.equal(
      await runtimePathAllowed(composition, pathname),
      false,
      pathname
    );
  }
});

test("caddy example proxies only to the localhost origin", async () => {
  const caddy = await readFile(
    resolve(import.meta.dirname, "../caddy.example"),
    "utf8"
  );

  assert.match(caddy, /DRYDOCK_ITERATE_HOSTNAME/);
  assert.match(caddy, /DRYDOCK_ITERATE_ORIGIN:127\.0\.0\.1:8090/);
  assert.match(caddy, /DRYDOCK_ITERATE_LOG/);
  assert.doesNotMatch(caddy, /file_server/);
});

test("path-mounted caddy example uses handle_path for existing domains", async () => {
  const caddy = await readFile(
    resolve(import.meta.dirname, "../caddy.path.example"),
    "utf8"
  );

  assert.match(caddy, /DRYDOCK_HOSTNAME/);
  assert.match(caddy, /DRYDOCK_ITERATE_ROUTE/);
  assert.match(
    caddy,
    /DRYDOCK_ITERATE_ORIGIN:127\.0\.0\.1:8090/
  );
  assert.doesNotMatch(caddy, /file_server/);
});

test("systemd example invokes the project-aware localhost origin", async () => {
  const unit = await readFile(
    resolve(
      import.meta.dirname,
      "../systemd/drydock-web-iterate.service.example"
    ),
    "utf8"
  );

  assert.match(
    unit,
    /start\.sh --project shipping\/drydock-project\.json --port \$\{DRYDOCK_ITERATE_PORT\}/
  );
  assert.match(unit, /Environment=DRYDOCK_ITERATE_PORT=8090/);
  assert.doesNotMatch(unit, /\/usr\/games\//);
  assert.match(unit, /IPAddressAllow=localhost/);
  assert.match(unit, /NoNewPrivileges=true/);
  assert.match(unit, /ProtectSystem=strict/);
  assert.doesNotMatch(unit, /0\.0\.0\.0/);
});

test("port parsing defaults and validates explicit ports", () => {
  assert.equal(parsePort([]), 8090);
  assert.equal(parsePort(["--port", "0"]), 0);
  assert.equal(parsePort(["--port", "9000"]), 9000);
  assert.throws(() => parsePort(["--port", "nope"]), /--port/);
  assert.throws(() => parsePort(["--port", "9000", "--port", "9001"]), /once/);
  assert.throws(() => parsePort(["--unknown"]), /unknown/);
});

test("public CLI serves a project outside its working directory", async (context) => {
  const fixture = await createMinimalProject(context);
  const entrypoint = resolve(
    import.meta.dirname,
    "../../../../../tools/drydock.js"
  );
  const child = spawn(
    process.execPath,
    [
      entrypoint,
      "iterate",
      "web",
      "--project",
      fixture.projectPath,
      "--port",
      "0"
    ],
    {
      cwd: resolve(import.meta.dirname, "../../../../.."),
      stdio: [
        "ignore",
        "pipe",
        "pipe"
      ]
    }
  );
  context.after(() => {
    if (child.exitCode === null) {
      child.kill("SIGTERM");
    }
  });

  const origin = await waitForOrigin(child);
  assert.equal((await fetch(origin)).status, 200);
  assert.equal(
    await (await fetch(`${origin}game/src/platform-host.js`)).text(),
    "export const platform = \"overlay\";\n"
  );
  assert.equal(
    (await fetch(`${origin}shipping/drydock-project.json`)).status,
    404
  );

  const exit = once(child, "exit");
  child.kill("SIGTERM");
  await exit;
});

test("server serves declared runtime files and denies repository files", async (context) => {
  const composition = await createComposition(context);
  const server = createServer(composition);

  await new Promise((resolveListen) => {
    server.listen(0, "127.0.0.1", resolveListen);
  });

  try {
    const { port } = server.address();
    const root = `http://127.0.0.1:${port}`;

    assert.equal((await fetch(`${root}/`)).status, 200);
    assert.equal((await fetch(`${root}/game/src/value.js`)).status, 200);
    assert.equal(
      await (await fetch(`${root}/game/src/platform-host.js`)).text(),
      "export const platform = \"overlay\";\n"
    );
    assert.equal((await fetch(`${root}/host-bridge.js`)).status, 200);
    assert.equal((await fetch(`${root}/package.json`)).status, 404);
    assert.equal((await fetch(`${root}/.git/config`)).status, 404);
    assert.equal(
      (await fetch(`${root}/shipping/drydock-project.json`)).status,
      404
    );
    assert.equal(
      (await fetch(`${root}/game/src/value.js`, {
        method: "POST"
      })).status,
      405
    );
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
});

async function createComposition(context) {
  return loadMinimalComposition(await createMinimalProject(context));
}

function waitForOrigin(child) {
  return new Promise((resolveOrigin, rejectOrigin) => {
    let stderr = "";
    let stdout = "";
    const timeout = setTimeout(() => {
      rejectOrigin(new Error(
        `timed out waiting for live origin\nstdout: ${stdout}\nstderr: ${stderr}`
      ));
    }, 5000);

    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      const match = /Drydock live origin: (http:\/\/127\.0\.0\.1:\d+\/)/u.exec(
        stdout
      );
      if (match) {
        clearTimeout(timeout);
        resolveOrigin(match[1]);
      }
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      rejectOrigin(new Error(
        `live origin exited before listening (${code})\n${stderr}`
      ));
    });
  });
}
