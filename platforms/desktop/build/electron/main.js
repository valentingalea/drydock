const { existsSync } = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, ipcMain, protocol, session } = require("electron");
const { createElectronHostProvider, registerHostIpc } = require("./host-provider.js");
const { appHost, appScheme, createAppProtocolHandler } = require("./protocol.js");

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

function resolveRuntimeRoot() {
  if (process.env.DRYDOCK_RUNTIME_ROOT) {
    return path.resolve(process.env.DRYDOCK_RUNTIME_ROOT);
  }

  const packagedRuntimeRoot = path.resolve(__dirname, "runtime");

  if (existsSync(path.join(packagedRuntimeRoot, "index.html"))) {
    return packagedRuntimeRoot;
  }

  throw new Error("composed Electron runtime is missing; build or set DRYDOCK_RUNTIME_ROOT");
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

function registerAppProtocol(protocolModule, runtimeRoot) {
  protocolModule.handle(appScheme, createAppProtocolHandler({ runtimeRoot }));
}

function createWindow(options = {}) {
  const win = new BrowserWindow(createWindowOptions(options));

  win.removeMenu();
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (event, targetUrl) => {
    const url = new URL(targetUrl);

    if (url.protocol !== `${appScheme}:` || url.host !== appHost) {
      event.preventDefault();
    }
  });

  win.loadURL(`${appScheme}://${appHost}/index.html`);
  return win;
}

async function boot() {
  const runtimeRoot = resolveRuntimeRoot();

  registerAppProtocol(protocol, runtimeRoot);
  await registerHostIpc(
    ipcMain,
    createElectronHostProvider({ userDataPath: app.getPath("userData") })
  );
  configureSession(session.defaultSession);
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
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
  registerAppProtocol,
  resolveRuntimeRoot
};
