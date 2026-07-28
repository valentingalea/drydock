const { readFileSync, statSync } = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, ipcMain, protocol, session } = require("electron");
const { createElectronHostProvider, registerHostIpc } = require("./host-provider.js");
const {
  appHost,
  appScheme,
  createAppProtocolHandler,
  runtimeEntrypointUrl,
  validateRuntimePolicy
} = require("./protocol.js");

protocol.registerSchemesAsPrivileged([
  {
    scheme: appScheme,
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true
    }
  }
]);

if (typeof app.enableSandbox === "function") {
  app.enableSandbox();
}

function resolveRuntimeRoot(runtimePolicy) {
  validateRuntimePolicy(runtimePolicy);
  const packagedRuntimeRoot = path.resolve(__dirname, "runtime");

  const entrypointPath = path.resolve(
    packagedRuntimeRoot,
    ...runtimePolicy.entrypoint.split("/")
  );

  try {
    if (statSync(entrypointPath).isFile()) {
      return packagedRuntimeRoot;
    }
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }

  throw new Error(
    `composed Electron runtime entrypoint is missing: ${runtimePolicy.entrypoint}`
  );
}

function loadRuntimePolicy() {
  const policyPath = path.resolve(__dirname, "runtime-policy.json");
  const policy = JSON.parse(readFileSync(policyPath, "utf8"));

  return validateRuntimePolicy(policy);
}

function createWindowOptions(options = {}) {
  return {
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    backgroundColor: "#0d1010",
    show: options.show ?? true,
    webPreferences: {
      preload: options.preloadPath ?? path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false
    }
  };
}

function configureSession(defaultSession) {
  defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
}

function registerAppProtocol(protocolModule, runtimeRoot, runtimePolicy) {
  protocolModule.handle(appScheme, createAppProtocolHandler({
    runtimePaths: runtimePolicy.runtimePaths,
    runtimeRoot,
    scriptHashes: runtimePolicy.scriptHashes
  }));
}

function createWindow(runtimePolicy, options = {}) {
  const win = new BrowserWindow(createWindowOptions(options));

  win.removeMenu();
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, targetUrl) => {
    const url = new URL(targetUrl);

    if (url.protocol !== `${appScheme}:` || url.host !== appHost) {
      event.preventDefault();
    }
  });

  win.loadURL(runtimeEntrypointUrl(runtimePolicy));
  return win;
}

async function boot() {
  const runtimePolicy = loadRuntimePolicy();
  const runtimeRoot = resolveRuntimeRoot(runtimePolicy);

  registerAppProtocol(protocol, runtimeRoot, runtimePolicy);
  await registerHostIpc(
    ipcMain,
    createElectronHostProvider({ userDataPath: app.getPath("userData") })
  );
  configureSession(session.defaultSession);
  createWindow(runtimePolicy);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(runtimePolicy);
    }
  });
}

app.whenReady().then(boot);

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

module.exports = {
  configureSession,
  createWindow,
  createWindowOptions,
  loadRuntimePolicy,
  registerAppProtocol,
  resolveRuntimeRoot
};
