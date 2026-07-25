const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { mkdir, mkdtemp, readFile, stat, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");
const {
  HOST_PROTOCOL_VERSION,
  HostErrorCode,
  createElectronHostProvider,
  invokeHost,
  isTrustedFrameUrl
} = require("../host-provider.js");
const {
  contentSecurityPolicy,
  resolveSafeRuntimePath,
  runtimePathAllowed,
  serveAppRequest
} = require("../protocol.js");

const repoRoot = resolve(__dirname, "../../../../..");

test("Electron protocol allowlist mirrors runtime-only payload paths", () => {
  assert.equal(runtimePathAllowed("/"), true);
  assert.equal(runtimePathAllowed("/index.html"), true);
  assert.equal(runtimePathAllowed("/host-bridge.js"), true);
  assert.equal(runtimePathAllowed("/vendor/drydock-host-bridge/index.js"), true);
  assert.equal(runtimePathAllowed("/engine/mock-game/"), true);
  assert.equal(runtimePathAllowed("/engine/mock-game/index.html"), true);
  assert.equal(runtimePathAllowed("/engine/mock-game/src/bootstrap.js"), true);
  assert.equal(runtimePathAllowed("/engine/mock-game/style/mock.css"), true);
  assert.equal(runtimePathAllowed("/engine/src/core/scope.js"), true);
  assert.equal(runtimePathAllowed("/engine/style/hud.css"), true);
  assert.equal(runtimePathAllowed("/engine/lib/three.module.js"), true);

  assert.equal(runtimePathAllowed("/package.json"), false);
  assert.equal(runtimePathAllowed("/drydock-artifact.json"), false);
  assert.equal(runtimePathAllowed("/.git/config"), false);
  assert.equal(runtimePathAllowed("/engine/AGENTS.md"), false);
  assert.equal(runtimePathAllowed("/engine/package.json"), false);
});

test("Electron CSP authorizes the exact Line Engine import map", async () => {
  const html = await readFile(resolve(repoRoot, "engine/mock-game/index.html"), "utf8");
  const importMap = html.match(/<script type="importmap">([\s\S]*?)<\/script>/)?.[1];

  assert.ok(importMap, "Line Engine mock import map is missing");
  const hash = createHash("sha256").update(importMap).digest("base64");
  assert.match(contentSecurityPolicy, new RegExp(`sha256-${hash.replace(/[+/=]/g, "\\$&")}`));
  const scriptPolicy = contentSecurityPolicy.split("; ")
    .find((directive) => directive.startsWith("script-src "));
  assert.doesNotMatch(scriptPolicy, /unsafe-inline/);
});

test("Electron protocol denies path traversal and sends security headers", async () => {
  const gameRoot = await mkdtemp(join(tmpdir(), "drydock-electron-game-"));
  await mkdir(join(gameRoot, "src"), { recursive: true });
  await writeFile(join(gameRoot, "index.html"), "<!doctype html><title>Drydock</title>");
  await writeFile(join(gameRoot, "src/main.js"), "export {};");

  assert.equal(resolveSafeRuntimePath(gameRoot, "/src/main.js"), join(gameRoot, "src/main.js"));
  assert.throws(() => resolveSafeRuntimePath(gameRoot, "/../secret.txt"), /path escapes/);

  const ok = await serveAppRequest({ url: "app://drydock/", method: "GET" }, { gameRoot });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get("Content-Security-Policy"), /default-src 'self'/);
  assert.match(contentSecurityPolicy, /object-src 'none'/);
  assert.match(contentSecurityPolicy, /sha256-DV2rnjt8VaGp9BWYzkk/);

  const denied = await serveAppRequest({ url: "app://drydock/package.json", method: "GET" }, { gameRoot });
  assert.equal(denied.status, 404);

  const wrongHost = await serveAppRequest({ url: "app://other/index.html", method: "GET" }, { gameRoot });
  assert.equal(wrongHost.status, 404);
});

test("Electron host provider passes shared host conformance", async () => {
  const { assertHostConformance } = await import(
    pathToFileURL(resolve(repoRoot, "contracts/host-bridge/src/index.js"))
  );
  const root = await mkdtemp(join(tmpdir(), "drydock-electron-host-"));
  const host = createElectronHostProvider({
    storageFile: join(root, "storage.json")
  });

  assert.equal(host.protocolVersion, HOST_PROTOCOL_VERSION);
  await assert.doesNotReject(assertHostConformance(host));
  await stat(join(root, "storage.json"));
});

test("Electron IPC dispatch validates service, method, arity, and frame origin", async () => {
  const root = await mkdtemp(join(tmpdir(), "drydock-electron-ipc-"));
  const host = createElectronHostProvider({
    storageFile: join(root, "storage.json")
  });

  assert.equal(isTrustedFrameUrl("app://drydock/index.html"), true);
  assert.equal(isTrustedFrameUrl("https://example.com/"), false);

  const save = await invokeHost(host, {
    service: "storage",
    method: "save",
    args: ["slot1", { value: true }]
  });
  assert.deepEqual(save, { ok: true, value: null });

  const badMethod = await invokeHost(host, {
    service: "storage",
    method: "readEverything",
    args: []
  });
  assert.equal(badMethod.ok, false);
  assert.equal(badMethod.code, HostErrorCode.InvalidArgument);

  const badArity = await invokeHost(host, {
    service: "storage",
    method: "load",
    args: []
  });
  assert.equal(badArity.ok, false);
  assert.equal(badArity.code, HostErrorCode.InvalidArgument);
});

test("Electron preload exposes only the typed host bridge wrapper", async () => {
  const preload = await readFile(resolve(__dirname, "../preload.js"), "utf8");

  assert.match(preload, /contextBridge\.exposeInMainWorld\("drydockHost", drydockHost\)/);
  assert.match(preload, /drydock:host|IPC_CHANNEL/);
  assert.doesNotMatch(preload, /exposeInMainWorld\([^)]*ipcRenderer/s);
});

test("Electron main process keeps security defaults explicit", async () => {
  const main = await readFile(resolve(__dirname, "../main.js"), "utf8");

  assert.match(main, /protocol\.registerSchemesAsPrivileged/);
  assert.match(main, /standard: true/);
  assert.match(main, /secure: true/);
  assert.match(main, /contextIsolation: true/);
  assert.match(main, /nodeIntegration: false/);
  assert.match(main, /sandbox: true/);
  assert.match(main, /setPermissionRequestHandler/);
  assert.match(main, /setWindowOpenHandler/);
});
