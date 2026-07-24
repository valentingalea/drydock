import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
  createServer,
  getGameRoot,
  parsePort,
  runtimePathAllowed
} from "../server.js";

const repoRoot = resolve(import.meta.dirname, "../../../../..");

test("live origin is rooted at game, not the repo root", () => {
  assert.equal(getGameRoot(), resolve(repoRoot, "game"));
});

test("runtime allowlist exposes only expected paths", () => {
  assert.equal(runtimePathAllowed("/"), true);
  assert.equal(runtimePathAllowed("/index.html"), true);
  assert.equal(runtimePathAllowed("/host-bridge.js"), true);
  assert.equal(runtimePathAllowed("/src/main.js"), true);
  assert.equal(runtimePathAllowed("/assets/sprite.png"), true);
  assert.equal(runtimePathAllowed("/vendor/drydock-host-bridge/index.js"), true);

  assert.equal(runtimePathAllowed("/package.json"), false);
  assert.equal(runtimePathAllowed("/../AGENTS.md"), false);
  assert.equal(runtimePathAllowed("/.git/config"), false);
});

test("caddy example proxies localhost and has no catch-all file access", async () => {
  const caddy = await readFile(resolve(import.meta.dirname, "../caddy.example"), "utf8");

  assert.match(caddy, /reverse_proxy 127\.0\.0\.1:8090/);
  assert.match(caddy, /@allowed path \/ \/index\.html \/host-bridge\.js \/src\/\* \/assets\/\* \/vendor\/\*/);
  assert.doesNotMatch(caddy, /file_server/);
});

test("path-mounted caddy example uses handle_path for existing domains", async () => {
  const caddy = await readFile(resolve(import.meta.dirname, "../caddy.path.example"), "utf8");

  assert.match(caddy, /redir \/drydock \/drydock\/ 308/);
  assert.match(caddy, /handle_path \/drydock\/\*/);
  assert.match(caddy, /reverse_proxy 127\.0\.0\.1:8090/);
  assert.doesNotMatch(caddy, /file_server/);
});

test("systemd example runs the localhost-only live origin with basic sandboxing", async () => {
  const unit = await readFile(
    resolve(import.meta.dirname, "../systemd/drydock-web-iterate.service.example"),
    "utf8"
  );

  assert.match(unit, /ExecStart=\/usr\/games\/Drydock\/platforms\/web\/iterate\/caddy-live\/start\.sh --port 8090/);
  assert.match(unit, /IPAddressAllow=localhost/);
  assert.match(unit, /NoNewPrivileges=true/);
  assert.match(unit, /ProtectSystem=strict/);
  assert.doesNotMatch(unit, /0\.0\.0\.0/);
});

test("port parsing defaults and validates explicit ports", () => {
  assert.equal(parsePort([]), 8090);
  assert.equal(parsePort(["--port", "9000"]), 9000);
  assert.throws(() => parsePort(["--port", "nope"]), /--port/);
});

test("server allows runtime files and denies repo files", async () => {
  const server = createServer();

  await new Promise((resolveListen) => {
    server.listen(0, "127.0.0.1", resolveListen);
  });

  try {
    const { port } = server.address();
    const root = `http://127.0.0.1:${port}`;

    assert.equal((await fetch(`${root}/`)).status, 200);
    assert.equal((await fetch(`${root}/src/main.js`)).status, 200);
    assert.equal((await fetch(`${root}/package.json`)).status, 404);
    assert.equal((await fetch(`${root}/.git/config`)).status, 404);
  } finally {
    await new Promise((resolveClose) => server.close(resolveClose));
  }
});
