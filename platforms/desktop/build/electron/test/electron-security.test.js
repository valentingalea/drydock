const assert = require("node:assert/strict");
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
  createContentSecurityPolicy,
  resolveSafeRuntimePath,
  runtimePathAllowed,
  serveAppRequest
} = require("../protocol.js");

const repoRoot = resolve(__dirname, "../../../../..");

test("Electron protocol allowlist accepts only staged runtime policy paths", () => {
  const runtimePaths = [
    "game/src/main.js",
    "host-bridge.js",
    "index.html",
    "vendor/drydock-host-bridge/index.js"
  ];

  assert.equal(runtimePathAllowed("/", runtimePaths), true);
  assert.equal(runtimePathAllowed("/index.html", runtimePaths), true);
  assert.equal(runtimePathAllowed("/host-bridge.js", runtimePaths), true);
  assert.equal(runtimePathAllowed("/game/src/main.js", runtimePaths), true);
  assert.equal(
    runtimePathAllowed("/vendor/drydock-host-bridge/index.js", runtimePaths),
    true
  );

  assert.equal(runtimePathAllowed("/package.json", runtimePaths), false);
  assert.equal(runtimePathAllowed("/drydock-artifact.json", runtimePaths), false);
  assert.equal(runtimePathAllowed("/.git/config", runtimePaths), false);
  assert.equal(runtimePathAllowed("/../secret.txt", runtimePaths), false);
  assert.equal(runtimePathAllowed("/game\\src\\main.js", runtimePaths), false);
});

test("Electron CSP accepts reviewed inline-script hashes without unsafe-inline", () => {
  const policy = createContentSecurityPolicy([
    "sha256-DV2rnjt8VaGp9BWYzkk/F9naieRwafKYVsxAf3g4gsQ="
  ]);
  const scriptPolicy = policy
    .split("; ")
    .find((directive) => directive.startsWith("script-src "));

  assert.match(policy, /default-src 'self'/);
  assert.match(policy, /sha256-DV2rnjt8VaGp9BWYzkk/);
  assert.doesNotMatch(scriptPolicy, /unsafe-inline/);
  assert.doesNotMatch(contentSecurityPolicy, /sha256-/);
  assert.throws(
    () => createContentSecurityPolicy(["sha256-not valid"]),
    /invalid script hash/
  );
});

test("Electron protocol denies traversal and sends security headers", async () => {
  const runtimeRoot = await mkdtemp(join(tmpdir(), "drydock-electron-runtime-"));
  await mkdir(join(runtimeRoot, "game"), {
    recursive: true
  });
  await writeFile(
    join(runtimeRoot, "index.html"),
    "<!doctype html><title>Drydock</title>"
  );
  await writeFile(join(runtimeRoot, "game/main.js"), "export {};");
  const options = {
    contentSecurityPolicy,
    runtimePaths: [
      "game/main.js",
      "index.html"
    ],
    runtimeRoot
  };

  assert.equal(
    resolveSafeRuntimePath(runtimeRoot, "/game/main.js"),
    join(runtimeRoot, "game/main.js")
  );
  assert.throws(
    () => resolveSafeRuntimePath(runtimeRoot, "/../secret.txt"),
    /path escapes/
  );

  const ok = await serveAppRequest(
    {
      method: "GET",
      url: "app://drydock/"
    },
    options
  );
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get("Content-Security-Policy"), /default-src 'self'/);
  assert.match(contentSecurityPolicy, /object-src 'none'/);

  const denied = await serveAppRequest(
    {
      method: "GET",
      url: "app://drydock/package.json"
    },
    options
  );
  assert.equal(denied.status, 404);

  const wrongHost = await serveAppRequest(
    {
      method: "GET",
      url: "app://other/index.html"
    },
    options
  );
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
    args: [
      "slot1",
      {
        value: true
      }
    ]
  });
  assert.deepEqual(save, {
    ok: true,
    value: null
  });

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

  assert.match(
    preload,
    /contextBridge\.exposeInMainWorld\("drydockHost", drydockHost\)/
  );
  assert.match(preload, /drydock:host|IPC_CHANNEL/);
  assert.doesNotMatch(preload, /exposeInMainWorld\([^)]*ipcRenderer/s);
});

test("Electron main process keeps security defaults and staged policy explicit", async () => {
  const main = await readFile(resolve(__dirname, "../main.js"), "utf8");

  assert.match(main, /protocol\.registerSchemesAsPrivileged/);
  assert.match(main, /standard: true/);
  assert.match(main, /secure: true/);
  assert.match(main, /contextIsolation: true/);
  assert.match(main, /nodeIntegration: false/);
  assert.match(main, /sandbox: true/);
  assert.match(main, /runtime-policy\.json/);
  assert.match(main, /setPermissionRequestHandler/);
  assert.match(main, /setWindowOpenHandler/);
  assert.doesNotMatch(main, /DRYDOCK_RUNTIME_ROOT/);
});
